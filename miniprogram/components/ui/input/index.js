Component({
  properties: {
    label: { type: String, value: '' },
    value: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    type: { type: String, value: 'text' },
    maxlength: { type: Number, value: 140 },
    required: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    error: { type: String, value: '' }
  },

  data: {
    focused: false
  },

  methods: {
    onInput(e) {
      this.triggerEvent('change', { value: e.detail.value })
    },
    onFocus() {
      this.setData({ focused: true })
    },
    onBlur() {
      this.setData({ focused: false })
    }
  }
})
