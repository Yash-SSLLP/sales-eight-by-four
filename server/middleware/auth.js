import jwt from 'jsonwebtoken';

export const protect = (req, res, next) => {
  const auth = req.headers.authorization;
  if(!auth?.startsWith('Bearer ')) return res.status(401).json({ error:'No token' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error:'Invalid token' });
  }
};

// Accept BOTH admin and superadmin everywhere we previously accepted "admin".
// This keeps existing routes working while adding superadmin as the elevated tier.
export const adminOnly = (req, res, next) => {
  const role = req.user?.role;
  if(role !== 'admin' && role !== 'superadmin') return res.status(403).json({ error:'Admins only' });
  next();
};

// New: superadmin-only routes (impersonation, managing admins, etc.)
export const superAdminOnly = (req, res, next) => {
  if(req.user?.role !== 'superadmin') return res.status(403).json({ error:'Superadmin only' });
  next();
};
