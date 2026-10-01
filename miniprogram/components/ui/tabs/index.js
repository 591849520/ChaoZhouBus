Component({
  properties: {
    options: {
      type: Array,
      value: [],
    },
    value: {
      type: String,
      value: '',
    },
    variant: {
      type: String,
      value: 'segmented', // segmented | pills
    },
  },
  methods: {
    handleSelect(e) {
      const selectedValue = String(e.currentTarget.dataset.value || '');
      if (selectedValue === this.properties.value) {
        return;
      }
      const payload = Object.assign({ value: selectedValue }, this.dataset || {});
      this.triggerEvent('change', payload);
    },
  },
});
