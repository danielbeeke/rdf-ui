import { FormElement } from '../Types'
import { FormElementBase } from './FormElementBase'

export class Color extends FormElementBase implements FormElement {

  static type: string = 'color'

  async templateItem (index, value, placeholder = null) {
    const itemValue = value?.['@value'] ?? value

    return this.html`
    <input
      type="color"
      onchange="${event => this.on(event, index)}"
      onkeyup="${event => this.on(event, index)}"
      type="text"
      placeholder="${placeholder ?? this.Field.placeholder}"
      .value="${itemValue}"
      required="${this.isRequired(index)}"
    >`
  }
}