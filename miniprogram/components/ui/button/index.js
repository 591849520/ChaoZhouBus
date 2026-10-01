Component({
  properties: {
    text: { type: String, value: '' },
    variant: { type: String, value: 'default' }, // default | destructive | outline | secondary | ghost
    size: { type: String, value: 'md' }, // sm | md | lg
    block: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    debounceMs: { type: Number, value: 0 }, // 例如传入 1500 自动防抖锁定 1.5s
  },

  data: {
    isCoolingDown: false,
  },

  methods: {
    handleTap(e) {
      if (this.data.disabled || this.data.loading || this.data.isCoolingDown) {
        return;
      }

      const waitMs = Number(this.data.debounceMs) || 0;
      if (waitMs > 0) {
        this.setData({ isCoolingDown: true });
        setTimeout(() => {
          this.setData({ isCoolingDown: false });
        }, waitMs);
      }

      // 将组件自身的 dataset 合并到 detail 中，确保无论通过 e.currentTarget.dataset 还是 e.detail 均能取到参数
      const payload = Object.assign({}, e.detail || {}, this.dataset || {});
      this.triggerEvent('click', payload);
      this.triggerEvent('action', payload);
    },
  },
});
