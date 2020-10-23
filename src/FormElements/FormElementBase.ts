/**
 * This is the base class for every form element.
 * You can extend this class and only overwrite the template methods that you want to change.
 *
 * Also if you only want to change css classes you can use the following:
 * - Inspect the template and search for classy:IDENTIFIER="DEFAULT_CLASSES"
 * - Before starting RdfForm call:
 * - Classy.add(IDENTIFIER, ['your', 'classes'])
 * - Classy.add('formElement', ['your', 'classes'])
 */

import { newEngine } from '@comunica/actor-init-sparql'
import { RdfForm } from '../RdfForm'
import { library } from '@fortawesome/fontawesome-svg-core'
import { faTimes, faQuestionCircle, faPlus, faLanguage, faCog } from '@fortawesome/free-solid-svg-icons'
import { fieldPrototype } from '../Types'
import {debounce, waiter, fetchObjectByPredicates, fa } from '../Helpers'
import { Classy } from '../Classy'

const { PathFactory } = require('../../../LDflex/lib/index.js');
const { default: ComunicaEngine } = require('../../../LDflex-Comunica');
const { namedNode } = require('@rdfjs/data-model');

library.add(faTimes, faQuestionCircle, faPlus, faLanguage, faCog)

export class FormElementBase extends EventTarget {

  static type: string = 'base'

  public expanded = new Map()
  public field: fieldPrototype
  public form: RdfForm
  public values: Array<any> = []
  public html: any
  public searchSuggestions = []
  public metas = new Map()
  public render: any

  private menuIsOpen: boolean = false
  private pathContext = {
    "schema": "http://schema.org/",
    "dbo": "http://dbpedia.org/ontology/",
    "dbp": "http://dbpedia.org/property/",
    "foaf": "http://xmlns.com/foaf/0.1/",
    "dc": "http://purl.org/dc/terms/",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
  }

  constructor (field, rdfForm: RdfForm) {
    super()
    this.html = Classy
    this.form = rdfForm
    this.field = field

    this.pathContext['@language'] = this.form.language

    this.values = this.form.expandedData[this.field.binding] ? (
      Array.isArray(this.form.expandedData[this.field.binding]) ?
      this.form.expandedData[this.field.binding] :
      [this.form.expandedData[this.field.binding]]
    ) : []

    this.render = debounce(() => this.form.render(), 100)
  }

  async init () {}

  /************************************************************************
   * Getters and setters.
   ************************************************************************/

  get label () {
    const label = this.field.label[this.form.language]
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : ''
  }

  get description () {
    return ''
  }

  get hasTranslations () {
    return !!this.values?.[0]?.['@language']
  }

  get anotherTranslationIsPossible () {
    const usedLanguagesCount = this.values.map(value => value['@language']).length
    const i14nLanguagesCount = Object.keys(this.form.i14nLanguages).length
    return this.hasTranslations && usedLanguagesCount < i14nLanguagesCount
  }

  showRemoveButton (index) {
    return index > 0
  }

  isRequired (index) {
    return index === 0 && this.field.required
  }

  getMenuButtons () {
    const buttons = []

    if (this.field.translatable && !this.hasTranslations) {
      buttons.push(this.createButton('add', 'enableTranslations', 'Create translation'))
    }

    if (this.field.translatable && this.hasTranslations) {
      buttons.push(this.createButton('remove', 'removeTranslations', 'Remove translations'))
    }

    return buttons
  }

  /************************************************************************
   * Mutators.
   ************************************************************************/

  addTranslation () {
    let usedLanguages = this.values.map(value => value['@language'])
    let unusedLanguages = Object.keys(this.form.i14nLanguages).filter(language => !usedLanguages.includes(language))

    if (unusedLanguages.length) {
      this.values.push({ '@value': '', '@language': unusedLanguages.shift() })
    }
  }

  addItem () {
    if (typeof this.values[0] === 'object') {
      const newItem = Object.assign({}, this.values[0], { '@value': '' })
      if (newItem['@id']) newItem['@id'] = ''
      this.values.push(newItem)
    }
    else {
      this.values.push('')
    }
  }

  removeItem (index) {
    this.values.splice(index, 1)
  }

  enableTranslations () {
    for (const [index, value] of this.values.entries()) {
      if (typeof value === 'object') {
        this.values[index]['@language'] = this.form.language
      }
      else {
        this.values[index] = {
          '@value': this.values[index],
          '@language': this.form.language
        }
      }
    }
  }

  removeTranslations () {
    if (this.values?.[0]?.['@language'] && this.values?.[0]?.['@value']) {
      this.values = [this.values?.[0]?.['@value']]
    }
  }

  setValue (event, index) {
    if (!event?.target?.value) return
    if (typeof this.values[index]?.['@value'] !== 'undefined') {
      this.values[index]['@value'] = event.target.value
    }
    else if (typeof this.values[index]?.['@id'] !== 'undefined') {
      this.values[index]['@id'] = event.target.value
    }
    else {
      this.values[index] = event.target.value
    }
  }

  async selectSuggestion (suggestionUrl, index) {
    this.searchSuggestions = []
    if (!this.values[index]?.['@id']) {
      this.values[index] = { '@id': '' }
    }
    this.values[index]['@id'] = suggestionUrl
    this.expanded.set(index, false)
    await this.updateMetas()
  }

  removeReference (index) {
    this.values[index]['@id'] = ''
  }

  /************************************************************************
   * Helpers.
   ************************************************************************/

  createButton (buttonClass, method, label) {
    return this.html`<button class="${'button ' + buttonClass}" onclick="${() => {
      this[method]()
      this.render()
    }}">${this.form.t.direct(label)}</button>`
  }

  on (event, index) {
    this.setValue(event, index)
    this.dispatchEvent(new CustomEvent(event.type, {
      detail: {
        originalEvent: event,
        index: index,
        value: event.target.value
      }
    }))
  }

  async searchSuggestionsSparqlQuery (query, searchTerm, source) {
    if (!searchTerm || searchTerm.length < 4) return

    query = query.replace(/LANGUAGE/g, this.form.language)
    query = query.replace(/SEARCH_TERM/g, searchTerm)

    const config = {}
    if (this.form.proxy) config['httpProxyHandler'] = this.form.proxy
    const myEngine = newEngine();
    const result = await myEngine.query(query, Object.assign({ sources: [source] }, config));

    /** @ts-ignore */
    const bindings = await result.bindings()

    for (const binding of bindings) {
      let label = binding.get('?label')?.id
      if (label.split('"').length > 1) label = label.split('"')[1]
      const uri = binding.get('?uri')?.id
      let image = binding.get('?image')?.id
      this.searchSuggestions.push({ label, uri, image })
    }
  }

  async prepareSparqlQuery (searchTerm: string = '') {
    const query: string = this.field.autoCompleteQuery
    const source = this.field.autoCompleteSource.replace(/SEARCH_TERM/g, searchTerm)
    return this.searchSuggestionsSparqlQuery(query, searchTerm, source)
  }

  async dbpediaSuggestions (searchTerm: string) {
    const response = await fetch(`https://lookup.dbpedia.org/api/prefix?query=${searchTerm}`)
    const xml = await response.text();

    const parser = new DOMParser();
    const dom: any = parser.parseFromString(xml, 'application/xml')

    this.searchSuggestions = []

    for (const result of dom.querySelectorAll('Result')) {
      const label = result.querySelector('Label').textContent
      const uri = result.querySelector('URI').textContent

      // Dedup languages.
      if (uri.substr(0, 18) === 'http://dbpedia.org') {
        this.searchSuggestions.push({ label, uri })
      }
    }
  }

  async updateMetas () {
    for (const value of this.values) {
      const uri = value?.['@id']

      if (!this.metas.get(uri)) {
        const queryEngine = new ComunicaEngine(uri, {
          'httpProxyHandler': this.form.proxy
        });

        const path = new PathFactory({ context: this.pathContext, queryEngine });
        this.metas.set(uri, path.create({ subject: namedNode(uri) }))
      }
    }
  }

  /************************************************************************
   * Templates.
   ************************************************************************/

  async templateLabel () {
    return this.label ? this.html`
    <label classy:label="label">
      ${this.label}
      ${this.field.required ? this.html`<span>*</span>` : ''}
      ${await this.templateFieldMenu()}
    </label>` : ''
  }

  async templateDescription () {
    return this.description ? this.html`
    <small classy:description="description">
      ${this.description}
    </small>` : ''
  }

  async templateItem (index, value) {
    const textValue = value?.['@value'] ?? value

    return this.html`
    <input
      onchange="${event => this.on(event, index)}"
      onkeyup="${event => this.on(event, index)}"
      type="text"
      value="${textValue}"
      required="${this.isRequired(index)}"
    >`
  }

  async templateLanguageSelector (index, value) {
    const selectedLanguage = value['@language']
    let usedLanguages = this.values.map(value => value['@language'])
    let unusedLanguages = Object.keys(this.form.i14nLanguages).filter(language => !usedLanguages.includes(language))
    unusedLanguages.push(selectedLanguage)

    return this.html`
    <select onchange="${event => this.values[index]['@language'] = event.target.value}" classy:languageSelector="language-selector">
    ${unusedLanguages.map((language) => {
      return language === selectedLanguage ? this.html`
        <option value="${language}" selected>${this.form.i14nLanguages[language]}</option>
        ` : this.html`
        <option value="${language}">${this.form.i14nLanguages[language]}</option>
        `
    })}
    </select>`
  }

  async templateItemFooter (index, value) {
    return false
  }

  async templateReferenceLabel (flexPath) {
    const waiterId = await flexPath.toString() + '@' + this.form.language
    const labelPromise = fetchObjectByPredicates(flexPath, this.form.language, ['rdfs:label', 'foaf:name', 'schema:name'])
    const thumbnailPromise = fetchObjectByPredicates(flexPath, this.form.language, ['dbo:thumbnail', 'foaf:depiction', 'schema:image'])
    const label = waiter(waiterId + 'label', labelPromise, this.render)
    const thumbnail = waiter(waiterId + 'thumbnail', thumbnailPromise, this.render)

    return this.html`
      <div classy:referenceLabel="reference-label">
        ${thumbnail.loading ? '' : this.html`<img src="${thumbnail}">`}
        ${label.loading ? this.form.t.direct('Loading...') : label}
      </div>
    `
  }

  async templateFieldMenu () {
    const buttons = this.getMenuButtons()

    return buttons.length ? this.html`
      <div classy:menu-wrapper="menu-wrapper">
        <button classy:menuButton="menu-button button" onclick="${() => {this.menuIsOpen = !this.menuIsOpen; this.render()}}">
            ${fa(faCog)}
        </button>
        <ul onclick="${() => {this.menuIsOpen = false; this.render()}}" open="${this.menuIsOpen}" classy:menu="menu">
          ${buttons.map(button => this.html`<li>${button}</li>`)}
        </ul>
      </div>
    ` : ''
  }

  async templateRemoveButton (index) {
    return this.html`
    <button class="button remove" onclick="${() => {
      this.removeItem(index)
      this.render()
      }}">
      ${fa(faTimes)}
    </button>`
  }

  async templateSearchSuggestions (index) {
    return this.searchSuggestions.length ? this.html`
    <ul classy:searchSuggestions="search-suggestions">
      ${this.searchSuggestions.map(suggestion => this.html`
      <li classy:searchSuggestion="search-suggestion" onclick="${async () => {
        await this.selectSuggestion(suggestion.uri, index); this.render()
      }}">
        ${suggestion.image ? this.html`<img src="${suggestion.image}">` : ''}
        <span classy:suggestionTitle="title">${suggestion.label}</span>
      </li>`)}
    </ul>
      ` : ''
  }

  /**
   * Called via the RdfForm
   * @see RdfForm.render()
   */
  async templateWrapper () {
    const countToRender = this.values.length ? this.values.length : 1

    const itemsToRender = []
    for (let i = 0; i < countToRender; i++) {
      itemsToRender.push(this.values[i] ? this.values[i] : null)
    }

    return this.html`
    <div classy:wrapper="form-element" type="${this.constructor.name.toLowerCase()}">

      ${await this.templateLabel()}

      ${this.html`
        <div classy:items="items">
        ${await Promise.all(itemsToRender.map(async (value, index) => {
          const templateItemFooter = await this.templateItemFooter(index, value)

          return this.html`
          <div classy:item="item" expanded="${this.expanded.get(index)}">
            ${await this.templateItem(index, value)}
            ${this.values[index]?.['@language'] ? await this.templateLanguageSelector(index, value) : ''}
            ${await this.templateRemoveButton(index)}
            ${templateItemFooter ? this.html`<div classy:item-footer="item-footer">${templateItemFooter}</div>` : ''}
          </div>
        `}))}
        </div>
      `}

      ${await this.templateDescription()}

      <div classy:actions="actions">
        ${this.field.translatable && this.anotherTranslationIsPossible && this.hasTranslations ? this.html`<button class="button add" onclick="${() => {
          this.addTranslation()
          this.render()
        }}">${this.form.t.direct('Add translation')}</button>` : ''}

        ${this.field.multiple ? this.html`<button class="button add" onclick="${() => {
          this.addItem()
          this.render()
        }}">${this.form.t.direct('Add item')}</button>` : ''}
      </div>
    </div>`
  }

}

