import mongoose from 'mongoose';
const S = new mongoose.Schema({
  id:              { type:String, required:true, unique:true },
  name:            { type:String, required:true },
  pass:            { type:String, required:true },
  // Roles (ascending privilege):
  //   salesman   — sees only their own dealers, follow-ups, monthly entries
  //   admin      — sees all data, can manage salesmen, cannot manage admins/superadmins, cannot impersonate
  //   superadmin — full access including managing all users and impersonating any user
  role:            { type:String, enum:['salesman','admin','superadmin'], default:'salesman' },
  color:           { type:String, default:'#818cf8' },
  ini:             { type:String, default:'??' },
  url:             { type:String, default:null },
  url2:            { type:String, default:null },
  url_outstanding: { type:String, default:null },
}, { timestamps:true });
export default mongoose.models.User || mongoose.model('User', S);
