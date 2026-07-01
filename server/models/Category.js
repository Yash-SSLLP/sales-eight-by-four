import mongoose from 'mongoose';

/**
 * Category Type and Sub-Category Type (Product Type) — admin-managed taxonomy.
 *
 * Each Category document holds an embedded list of sub-categories (product types).
 * One sub-category belongs to exactly one category, so the embedded list keeps
 * the relationship cheap to read.
 *
 * Examples:
 *   { name: 'LAMINATE',      subCategories: [ { name: '1 MM' }, { name: 'OMBRE' } ] }
 *   { name: 'POLYMER SHEET', subCategories: [ { name: 'GAG' }, { name: 'MCS' }, ... ] }
 */

const SubCategorySchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  createdAt: { type: Date,   default: Date.now },
}, { _id: true });

const CategorySchema = new mongoose.Schema({
  name:          { type: String, required: true, unique: true, trim: true },
  subCategories: { type: [SubCategorySchema], default: [] },
  createdBy:     { type: String, default: '' },
}, { timestamps: true });

// Helper used by the upload pipeline — given a sub-category name, find which
// category it belongs to (case-insensitive). Returns the parent doc or null.
CategorySchema.statics.findParentBySubName = async function (subName) {
  if (!subName) return null;
  const needle = String(subName).trim().toLowerCase();
  const all = await this.find({}).lean();
  for (const cat of all) {
    if ((cat.subCategories || []).some(s => String(s.name).trim().toLowerCase() === needle)) {
      return cat;
    }
  }
  return null;
};

export default mongoose.models.Category || mongoose.model('Category', CategorySchema);
