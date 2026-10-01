Component({
  properties: {
    label: { type: String, value: '' },
    value: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    type: { type: String, value: 'text' },
    maxlength: { type: Number, value: 140 },
    required: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    focused: false,
  },

  methods: {
    onInput(e) {
      const payload = { value: e.detail.value };
      this.triggerEvent('input', payload);
      this.triggerEvent('change', payload);
    },
    onFocus(e) {
      this.setData({ focused: true });
      this.triggerEvent('focus', e.detail);
    },
    onBlur(e) {
      this.setData({ focused: false });
      this.triggerEvent('blur', e.detail);
    },
  },
});
