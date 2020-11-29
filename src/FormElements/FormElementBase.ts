/**
 * This is the base class for every form element.
 * You can extend this class and overwrite the template methods that you want to change.
 *
 * Also if you only want to change css classes you can use the following:
 * - Inspect the template and search for classy:IDENTIFIER="DEFAULT_CLASSES"
 * - Before starting RdfForm call:
 * - Classy.add(IDENTIFIER, ['your', 'classes'])
 * - Classy.add('formElement', ['your', 'classes'])
 */

import { newEngine } from '@comunica/actor-init-sparql'
import { RdfForm } from '../RdfForm'
import { faTimes, faCog } from '@fortawesome/free-solid-svg-icons'
import { FieldDefinitionOptions } from '../Types'
import { debounce, waiter, fetchObjectByPredicates, fa } from '../Helpers'
import { Classy } from '../Classy'

const { PathFactory } = require('../../../LDflex/lib/index.js');
const { default: ComunicaEngine } = require('../../../LDflex-Comunica');
const { namedNode } = require('@rdfjs/data-model');
import { FieldValues } from '../FieldValues'
import { FieldDefinition } from '../FieldDefinition'
import { Language, t } from '../LanguageService'

export class FormElementBase extends EventTarget {

  static type: string = 'base'

  public expanded = new Map()
  public form: RdfForm
  public values: Array<any> = []
  public Values: FieldValues
  public Field: FieldDefinition
  public html: any
  public searchSuggestions: Map<string, Array<any>> = new Map()
  public metas = new Map()
  public render: any
  public isLoading = new Map()

  private menuIsOpen: boolean = false
  private pathContext = {
    "schema": "http://schema.org/",
    "dbo": "http://dbpedia.org/ontology/",
    "dbp": "http://dbpedia.org/property/",
    "foaf": "http://xmlns.com/foaf/0.1/",
    "dc": "http://purl.org/dc/terms/",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
  }

  constructor (field: FieldDefinitionOptions, rdfForm: RdfForm) {
    super()
    this.html = Classy
    this.form = rdfForm
    this.Field = FieldDefinition(field)
    this.pathContext['@language'] = Language.current
    this.Values = new FieldValues(this.form.expandedData[this.Field.binding])
    this.render = debounce(() => this.form.render(), 100)
  }

  async init () {}

  /************************************************************************
   * Getters and setters.
   ************************************************************************/

  getType () {
    /** @ts-ignore */
    return this.constructor.type.toLowerCase()
  }

  shouldShowExpanded (index) {
     return this.expanded.get(index) ||
      !this.Values.get(index) ||
      this.isLoading.get(index)
  }

  isRequired (index) {
    return index === 0 && this.Field.required ? true : null
  }

  isRemovable (index) {
    return !(this.Field.required && this.Values.length < 2)
  }

  getMenuButtons () {
    const buttons = []

    const createButton = (buttonClass, method, label) => {
      return this.html`<button type="button" class="${'button ' + buttonClass}" onclick="${() => {
        method()
        this.render()
      }}">${t.direct(label)}</button>`
    }

    if (this.Field.translatable && !this.Values.hasTranslations) {
      buttons.push(createButton('add', () => this.Values.enableTranslations(), 'Create translation'))
    }

    if (this.Field.translatable && this.Values.hasTranslations) {
      buttons.push(createButton('remove', () => this.Values.removeTranslations(), 'Remove translations'))
    }

    return buttons
  }

  serialize () {
    return this.Values.getAll()
  }

  /*****************************************************************************************************************
   * Mutators.
   *****************************************************************************************************************/

  async selectSuggestion (suggestionUrl, index) {
    this.searchSuggestions.set(index, [])
    this.Values.set(index, { '@id': suggestionUrl })
    this.expanded.set(index, false)
    await this.updateMetas()
  }

  async selectValue (value, index) {
    this.Values.set(index, { '@value': value })
    this.expanded.set(index, false)
    this.searchSuggestions.set(index, [])
  }

  on (event, index) {
    if (event.type in ['keyup', 'change']) {
      this.Values.setValue(event?.target?.value, index)
    }

    this.dispatchEvent(new CustomEvent(event.type, {
      detail: {
        originalEvent: event,
        index: index,
        value: event.target.value
      }
    }))
  }

  async updateMetas () {
    for (const value of this.Values.getAll()) {
      const uri = value?.['@id']

      if (uri && !this.metas.get(uri)) {
        const queryEngine = new ComunicaEngine(uri, {
          'httpProxyHandler': this.form.proxy
        });

        /**
         * Temporary workaround for:
         * https://github.com/LDflex/LDflex/issues/70
         *
         * TODO Would it be a good idea to only use on Comunica engine for the whole form, does it improve caching?
         */
        const myEngine = newEngine();
        if (this.form.proxy) myEngine['httpProxyHandler'] = this.form.proxy
        queryEngine._engine = myEngine

        const path = new PathFactory({ context: this.pathContext, queryEngine });
        this.metas.set(uri, path.create({ subject: namedNode(uri) }))
      }
    }
  }

  /************************************************************************
   * Templates.
   ************************************************************************/

  async templateLabel () {
    return this.Field.label ? this.html`
    <label classy:label="label">
      ${this.Field.label}
      ${this.Field.required ? this.html`<span>*</span>` : ''}
      ${await this.templateFieldMenu()}
    </label>` : ''
  }

  async templateDescription () {
    return this.Field.description ? this.html`
    <small classy:description="description">
      ${this.Field.description}
    </small>` : ''
  }

  async templateItem (index, value, placeholder = null) {
    const textValue = value?.['@value'] ?? value

    return this.html`
    <input
      onchange="${event => this.on(event, index)}"
      onkeyup="${event => this.on(event, index)}"
      type="text"
      placeholder="${placeholder ?? this.Field.placeholder}"
      value="${textValue}"
      required="${this.isRequired(index)}"
    >`
  }

  async templateLanguageSelector (index, value) {
    const selectedLanguage = value['@language']
    let usedLanguages = this.Values.getAll().map(value => value['@language'])
    let unusedLanguages = Object.keys(Language.i10nLanguages).filter(language => !usedLanguages.includes(language))
    unusedLanguages.push(selectedLanguage)

    return this.html`
    <select onchange="${event => this.Values.get(index)['@language'] = event.target.value}" classy:languageSelector="language-selector">
    ${unusedLanguages.map((language) => this.html`
      <option value="${language}" selected="${language === selectedLanguage ? true : null}">${Language.i10nLanguages[language]}</option>
    `)}
    </select>`
  }

  async templateItemFooter (index, value) {
    return false
  }

  async templateReferenceLabel (flexPath, uri) {
    const waiterId = await flexPath.toString() + '@' + Language.current
    const labelPromise = fetchObjectByPredicates(flexPath, Language.current, ['rdfs:label', 'foaf:name', 'schema:name'])
    const thumbnailPromise = fetchObjectByPredicates(flexPath, Language.current, ['dbo:thumbnail', 'foaf:depiction', 'schema:image'])
    const label = waiter(waiterId + 'label', labelPromise, this.render)
    const thumbnail = waiter(waiterId + 'thumbnail', thumbnailPromise, this.render)

    return this.html`
      <div classy:referenceLabel="reference-label">
        ${thumbnail.loading ? '' : this.html`<img src="${thumbnail}">`}
        ${label.loading ? t.direct('Loading...') : this.html`<a href="${uri}" target="_blank">${label}</a>`}
      </div>
    `
  }

  async templateFieldMenu () {
    const buttons = this.getMenuButtons()

    return buttons.length ? this.html`
      <div classy:menu-wrapper="menu-wrapper" open="${this.menuIsOpen}">
        <button type="button" classy:menuButton="menu-button button" onclick="${() => {this.menuIsOpen = !this.menuIsOpen; this.render()}}">
            ${fa(faCog)}
        </button>
        <ul onclick="${() => {this.menuIsOpen = false; this.render()}}" classy:menu="menu">
          ${buttons.map(button => this.html`<li>${button}</li>`)}
        </ul>
      </div>
    ` : ''
  }

  async templateRemoveButton (index) {
    return this.html`
    <button type="button" class="button remove" onclick="${() => {
      this.Values.removeItem(index)
      this.render()
      }}">
      ${fa(faTimes)}
    </button>`
  }

  async templateSearchSuggestions (index) {
    const searchSuggestions = this.searchSuggestions.get(index) ?? []
    const hasResults = !(searchSuggestions[0]?.value)

    return searchSuggestions.length ? this.html`
    <ul classy:searchSuggestions="search-suggestions">
      ${!hasResults ? this.html`<li classy:searchSuggestionNoResults="search-suggestion no-results">
        <span classy:suggestionTitle="title">${t`Nothing found`}</span>
      </li>` : ''}
      ${searchSuggestions.map(suggestion => this.html`
      <li classy:searchSuggestion="search-suggestion" onclick="${async () => {
        if (suggestion.uri) {
          await this.selectSuggestion(suggestion.uri, index);
        }
        else if (suggestion.value) {
          await this.selectValue(suggestion.value, index);
        }

        this.render()
      }}">
        ${suggestion.image ? this.html`<img src="${suggestion.image}">` : ''}
        <span classy:suggestionTitle="title">${suggestion.label?.[Language.current] ?? suggestion.label}</span>
      </li>`)}
    </ul>
      ` : ''
  }

  /**
   * Called via the RdfForm
   * @see RdfForm.render()
   */
  async templateWrapper () {
    const countToRender = this.Values.length ? this.Values.length : 1

    const itemsToRender = []
    for (let i = 0; i < countToRender; i++) {
      itemsToRender.push(this.Values.get(i) ? this.Values.get(i) : null)
    }

    return this.html`
    <div classy:wrapper="form-element" type="${this.getType()}">

      ${await this.templateLabel()}

      ${this.html`
        <div classy:items="items">
        ${await Promise.all(itemsToRender.map(async (value, index) => {
          const templateItemFooter = await this.templateItemFooter(index, value)

          return this.html`
          <div classy:item="item" expanded="${this.shouldShowExpanded(index)}" loading="${this.isLoading.get(index)}">
            ${await this.templateItem(index, value)}
            ${this.Values.get(index) && this.Values.get(index)['@language'] ? await this.templateLanguageSelector(index, value) : ''}
            ${this.isRemovable(index) ? await this.templateRemoveButton(index) : ''}
            ${templateItemFooter ? this.html`<div classy:item-footer="item-footer">${templateItemFooter}</div>` : ''}
          </div>
        `}))}
        </div>
      `}

      ${await this.templateDescription()}

      <div classy:actions="actions">
        ${this.Field.translatable && this.Values.anotherTranslationIsPossible && this.Values.hasTranslations ? this.html`<button type="button" class="button add" onclick="${() => {
          this.Values.addTranslation()
          this.render()
        }}">${t.direct('Add translation')}</button>` : ''}

        ${this.Field.multiple ? this.html`<button type="button" class="button add" onclick="${() => {
          this.Values.addItem()
          this.render()
        }}">${t.direct('Add item')}</button>` : ''}
      </div>
    </div>`
  }

}

