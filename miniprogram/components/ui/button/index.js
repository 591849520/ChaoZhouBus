Component({
  properties: {
    text: { type: String, value: '' },
    variant: { type: String, value: 'default' }, // default | destructive | outline | secondary | ghost
    size: { type: String, value: 'md' }, // sm | md | lg
    block: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    debounceMs: { type: Number, value: 0 } // 例如传入 1500 自动防抖锁定 1.5s
  },

  data: {
    isCoolingDown: false
  },

  methods: {
    handleTap(e) {
      if (this.data.disabled || this.data.loading || this.data.isCoolingDown) {
        return
      }

      const waitMs = Number(this.data.debounceMs) || 0
      if (waitMs > 0) {
        this.setData({ isCoolingDown: true })
        setTimeout(() => {
          this.setData({ isCoolingDown: false })
        }, waitMs)
      }

      this.triggerEvent('action', e.detail)
    }
  }
})
