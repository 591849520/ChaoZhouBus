Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    description: { type: String, value: '' },
    badgeText: { type: String, value: '' },
    badgeVariant: { type: String, value: 'default' },
  },
});
