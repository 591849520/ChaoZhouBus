Component({
  properties: {
    variant: {
      type: String,
      value: 'default', // default | warning | destructive | success
    },
    title: {
      type: String,
      value: '',
    },
    description: {
      type: String,
      value: '',
    },
    actionText: {
      type: String,
      value: '',
    },
  },
  methods: {
    handleAction() {
      this.triggerEvent('action', {});
    },
  },
});
