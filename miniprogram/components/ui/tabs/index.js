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
      this.triggerEvent('change', { value: selectedValue });
    },
  },
});
