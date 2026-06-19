import mongoose from 'mongoose';

/**
 * Sale — one line item = one dealer × one sub-category × one month.
 *
 * The wide Excel upload (one row per dealer, columns = product types) is
 * exploded server-side into many of these documents so we can aggregate
 * cleanly later (by category, by dealer, by salesman).
 *
 * The month string is normalized to YYYY-MM (e.g. "2026-06") so queries
 * can use simple equality/range filters without needing Date parsing.
 */

const SaleSchema = new mongoose.Schema({
  dealerName:    { type: String, required: true, trim: true, index: true },
  dealerId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Dealer' },

  salesman:      { type: String, trim: true, index: true },

  month:         { type: String, required: true, index: true },     // "YYYY-MM"

  category:      { type: String, required: true, trim: true, index: true },
  subCategory:   { type: String, required: true, trim: true, index: true },

  qty:           { type: Number, default: 0 },

  uploadedBy:    { type: String, default: '' },
  uploadBatchId: { type: String, index: true },                     // groups one upload together
}, { timestamps: true });

// Each combination (dealer + sub-cat + month) is unique per upload batch.
SaleSchema.index({ dealerName: 1, subCategory: 1, month: 1 }, { unique: false });

export default mongoose.models.Sale || mongoose.model('Sale', SaleSchema);
