function elementoVista(ownerDocument) {
  const clases = new Set()
  const atributos = new Map()
  const seleccionados = new Map()
  const eventos = new Map()
  return {
    value: '',
    textContent: '',
    children: [],
    disabled: false,
    dataset: {},
    ownerDocument,
    isConnected: true,
    tabIndex: 0,
    open: false,
    showModal() {
      this.open = true
    },
    close(valor) {
      if (valor !== undefined) this.returnValue = valor
      this.open = false
      return this.emitir('close')
    },
    getClientRects() {
      return clases.has('oculto') ? [] : [{}]
    },
    get className() {
      return [...clases].join(' ')
    },
    set className(valor) {
      clases.clear()
      for (const clase of valor.split(/\s+/).filter(Boolean)) clases.add(clase)
    },
    classList: {
      add: (...items) => items.forEach((c) => clases.add(c)),
      remove: (...items) => items.forEach((c) => clases.delete(c)),
      contains: (c) => clases.has(c),
      toggle(c, valor = !clases.has(c)) {
        valor ? clases.add(c) : clases.delete(c)
        return valor
      }
    },
    append(...items) {
      this.children.push(...items)
    },
    appendChild(item) {
      this.children.push(item)
      return item
    },
    set innerHTML(valor) {
      this.html = valor
      this.children = []
      this.value = ''
    },
    get innerHTML() {
      return this.html ?? ''
    },
    replaceChildren(...items) {
      this.children = items
    },
    querySelector(selector) {
      if (!seleccionados.has(selector))
        seleccionados.set(selector, elementoVista(ownerDocument))
      return seleccionados.get(selector)
    },
    querySelectorAll() {
      return this.children
    },
    setAttribute: (nombre, valor) => atributos.set(nombre, valor),
    removeAttribute: (nombre) => atributos.delete(nombre),
    getAttribute: (nombre) => atributos.get(nombre),
    focus() {
      if (ownerDocument) ownerDocument.activeElement = this
    },
    select() {
      this.seleccionado = true
      this.focus()
    },
    addEventListener(nombre, handler) {
      if (!eventos.has(nombre)) eventos.set(nombre, [])
      eventos.get(nombre).push(handler)
    },
    async emitir(nombre, datos = {}) {
      const evento = {
        target: this,
        preventDefault() {
          this.defaultPrevented = true
        },
        ...datos
      }
      for (const handler of eventos.get(nombre) ?? []) await handler(evento)
      return evento
    }
  }
}

export function documentoVista(html) {
  const nodos = new Map()
  const todos = []
  const document = {
    activeElement: null,
    createElement: () => elementoVista(document),
    querySelector(selector) {
      if (!nodos.has(selector)) throw new Error(`Nodo ausente del HTML: ${selector}`)
      return nodos.get(selector)
    },
    querySelectorAll(selector) {
      if (selector.startsWith('.'))
        return todos.filter((el) => el.classList.contains(selector.slice(1)))
      throw new Error(`Selector de prueba no implementado: ${selector}`)
    }
  }
  for (const [tag] of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const elemento = elementoVista(document)
    for (const [, nombre, valor] of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
      elemento.setAttribute(nombre, valor)
      if (nombre === 'id') nodos.set(`#${valor}`, elemento)
      if (nombre === 'class') elemento.className = valor
      if (nombre.startsWith('data-')) elemento.dataset[nombre.slice(5)] = valor
    }
    todos.push(elemento)
  }
  return document
}
