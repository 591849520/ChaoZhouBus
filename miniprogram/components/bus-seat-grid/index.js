Component({
  properties: {
    standardRows: {
      type: Array,
      value: [],
    },
    backRow: {
      type: Array,
      value: [],
    },
  },
  methods: {
    handleSeatTap(e) {
      const seatNumber = String(e.currentTarget.dataset.seat || '');
      const status = Number(e.currentTarget.dataset.status || 0);
      if (!seatNumber) return;
      this.triggerEvent('selectSeat', { seatNumber, status });
    },
  },
});
