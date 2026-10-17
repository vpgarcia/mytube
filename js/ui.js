// Piezas de interfaz compartidas: creación de elementos, avisos, ventanas
// modales, teclado de PIN y campos de formulario.

export const $ = (id) => document.getElementById(id);

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'value' || key === 'checked' || key === 'disabled') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

export const ICONS = {
  up: 'M12 5 5 12h4v7h6v-7h4z',
  down: 'M12 19 5 12h4V5h6v7h4z',
  edit: 'M4 17.3V20h2.7l8-8L12 9.3l-8 8ZM19.7 7a1 1 0 0 0 0-1.4l-1.3-1.3a1 1 0 0 0-1.4 0l-1.6 1.6L18 8.6 19.7 7Z',
  trash: 'M7 6V4h10v2h4v2h-1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8H3V6h4Zm2 4v8h2v-8H9Zm4 0v8h2v-8h-2Z',
};

export function iconButton(label, path, onclick, { disabled = false, extra = '' } = {}) {
  return h('button', { class: `icon-btn ${extra}`, type: 'button', 'aria-label': label, title: label, onclick, disabled }, icon(path));
}

let currentScreen = 'loading';

export function show(screenId) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.hidden = s.id !== screenId;
  });
  currentScreen = screenId;
  window.scrollTo(0, 0);
}

export function screen() {
  return currentScreen;
}

let toastTimer = null;
export function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

export function hideToast() {
  $('toast').hidden = true;
}

export function modal(content) {
  const backdrop = h('div', { class: 'modal-backdrop' }, h('div', { class: 'modal' }, content));
  $('modal-root').append(backdrop);
  return () => backdrop.remove();
}

// Ventana con contenido libre y botones. Devuelve el `value` del botón
// pulsado, o null si se cancela. El primer botón con `submit` envía el form.
export function dialog({ title, content = [], actions }) {
  return new Promise((resolve) => {
    let close = () => {};
    const finish = (value) => {
      close();
      resolve(value);
    };
    const submit = actions.find((a) => a.submit);
    const form = h(
      'form',
      {
        class: 'dialog',
        onsubmit: (e) => {
          e.preventDefault();
          if (submit) finish(submit.value);
        },
      },
      h('h2', {}, title),
      content,
      h(
        'div',
        { class: 'dialog-actions' },
        actions.map((a) =>
          h(
            'button',
            {
              class: `btn ${a.class || ''}`,
              type: a.submit ? 'submit' : 'button',
              onclick: a.submit ? undefined : () => finish(a.value ?? null),
            },
            a.label,
          ),
        ),
      ),
    );
    close = modal(form);
  });
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'note' }, hint) : null);
}

export function select(options, value) {
  return h(
    'select',
    { class: 'input' },
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)),
  );
}

// Selector de emoji: devuelve un elemento con la propiedad `value`.
export function emojiPicker(options, value) {
  const wrap = h('div', { class: 'emoji-picker', role: 'radiogroup' });
  wrap.value = value || options[0];
  const render = () => {
    wrap.replaceChildren(
      ...options.map((e) =>
        h(
          'button',
          {
            type: 'button',
            class: `emoji-option ${e === wrap.value ? 'selected' : ''}`,
            'aria-label': e,
            onclick: () => {
              wrap.value = e;
              render();
            },
          },
          e,
        ),
      ),
    );
  };
  render();
  return wrap;
}

// Casillas múltiples: devuelve un elemento con la propiedad `value` (array).
export function checkboxes(options, values = []) {
  const inputs = options.map((o) => ({ o, input: h('input', { type: 'checkbox', checked: values.includes(o.value) }) }));
  const wrap = h('div', { class: 'checks' }, inputs.map(({ o, input }) => h('label', { class: 'check' }, input, o.label)));
  Object.defineProperty(wrap, 'value', { get: () => inputs.filter((i) => i.input.checked).map((i) => i.o.value) });
  return wrap;
}

export function toggle(label, checked) {
  const input = h('input', { type: 'checkbox', checked });
  const wrap = h('label', { class: 'check toggle' }, input, label);
  Object.defineProperty(wrap, 'value', { get: () => input.checked });
  return wrap;
}

// Teclado de PIN de 4 cifras. Con `validate`, no se cierra hasta acertar.
export function pinPad({ title, subtitle = '', validate = null, onForgot = null }) {
  return new Promise((resolve) => {
    let pin = '';
    const dots = h('div', { class: 'pin-dots' }, Array.from({ length: 4 }, () => h('span')));
    const box = h('div', { class: 'pin-box' });
    let close = () => {};

    const finish = (value) => {
      close();
      resolve(value);
    };

    const renderDots = () => {
      [...dots.children].forEach((d, i) => d.classList.toggle('filled', i < pin.length));
    };

    const press = async (digit) => {
      if (pin.length >= 4) return;
      pin += digit;
      renderDots();
      if (pin.length < 4) return;
      if (!validate || (await validate(pin))) {
        finish(pin);
      } else {
        box.classList.remove('shake');
        void box.offsetWidth;
        box.classList.add('shake');
        setTimeout(() => {
          pin = '';
          renderDots();
        }, 350);
      }
    };

    const keys = h(
      'div',
      { class: 'pin-keys' },
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => h('button', { class: 'pin-key', type: 'button', onclick: () => press(d) }, d)),
      h('button', { class: 'pin-key text', type: 'button', onclick: () => finish(null) }, 'Cancelar'),
      h('button', { class: 'pin-key', type: 'button', onclick: () => press('0') }, '0'),
      h(
        'button',
        {
          class: 'pin-key text',
          type: 'button',
          onclick: () => {
            pin = pin.slice(0, -1);
            renderDots();
          },
        },
        'Borrar',
      ),
    );

    box.append(h('h2', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : '', dots, keys);
    if (onForgot) {
      box.append(
        h(
          'button',
          {
            class: 'btn link',
            type: 'button',
            onclick: () => {
              finish(null);
              onForgot();
            },
          },
          '¿Olvidaste el PIN?',
        ),
      );
    }
    close = modal(box);
  });
}

// Pregunta que un niño pequeño no sabe contestar, para restablecer el PIN.
export async function adultCheck() {
  const a = 6 + Math.floor(Math.random() * 4);
  const b = 12 + Math.floor(Math.random() * 8);
  for (;;) {
    const input = h('input', { class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off' });
    setTimeout(() => input.focus(), 50);
    const ok = await dialog({
      title: 'Comprobación para adultos',
      content: [h('p', { class: 'muted' }, `¿Cuánto es ${a} × ${b}?`), input],
      actions: [
        { label: 'Cancelar', value: null },
        { label: 'Continuar', value: true, submit: true, class: 'primary' },
      ],
    });
    if (!ok) return false;
    if (Number(input.value) === a * b) return true;
    toast('Respuesta incorrecta');
  }
}

export async function chooseNewPin() {
  for (;;) {
    const first = await pinPad({ title: 'Elige un PIN', subtitle: '4 cifras para entrar al modo padre' });
    if (!first) return null;
    const second = await pinPad({ title: 'Repite el PIN' });
    if (!second) return null;
    if (first === second) return first;
    toast('Los PIN no coinciden. Prueba otra vez.');
  }
}

export async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt('Copia esto:', text);
  }
}
