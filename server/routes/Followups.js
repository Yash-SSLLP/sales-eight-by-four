import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/auth.js';
// IMPORTANT: import the canonical schema from models/Outstandingfollowup.js
// so new fields like `paymentProof`, `collectedAt`, `collectedAmount` are
// recognised by Mongoose. Declaring the schema inline here used to cause it
// to silently strip unknown fields on update.
import OutstandingFollowup from '../models/Outstandingfollowup.js';

const router = express.Router();

// Staff = admin OR superadmin (both see all follow-ups)
const isStaff = (req) => req.user?.role === 'admin' || req.user?.role === 'superadmin';

router.get('/', protect, async (req,res) => {
  try {
    if(isStaff(req)){
      return res.json(await OutstandingFollowup.find({}).sort({createdAt:-1}));
    }
    const Dealer = mongoose.models.Dealer;
    let myNames = new Set();
    if(Dealer){
      const myDealers = await Dealer.find({salesman:req.user.id},'name').lean();
      myNames = new Set(myDealers.map(d=>d.name.toLowerCase().trim()));
    }
    const all = await OutstandingFollowup.find({}).sort({createdAt:-1});
    const filtered = all.filter(f=>
      myNames.has((f.dealerName||'').toLowerCase().trim()) ||
      f.createdBy===req.user.id ||
      f.salesman===req.user.id
    );
    res.json(filtered);
  }catch(e){console.error('[FOLLOWUPS]',e.message); res.status(500).json({error:e.message});}
});

router.post('/', protect, async (req,res) => {
  try {
    const {dealerName,salesman,amount,followupDate,comment,type}=req.body;
    if(!dealerName||!followupDate) return res.status(400).json({error:'dealerName and followupDate required'});
    const f=await OutstandingFollowup.create({dealerName,salesman:salesman||req.user.id,amount:amount||0,followupDate,comment:comment||'',type:type||'followup',createdBy:req.user.id,status:'pending'});
    res.json(f);
  }catch(e){res.status(500).json({error:e.message});}
});

router.put('/:id', protect, async (req,res) => {
  try {
    const patch = { ...req.body };
    // Reject oversized payment-proof images (5 MB cap)
    if(patch.paymentProof && patch.paymentProof.length > 5 * 1024 * 1024){
      return res.status(413).json({ error:'Payment proof too large (compress before upload)' });
    }
    // Stamp collectedAt when status flips to 'done'
    if(patch.status === 'done'){
      patch.collectedAt = patch.collectedAt || new Date();
    }
    const f=await OutstandingFollowup.findByIdAndUpdate(req.params.id, patch, {new:true});
    res.json(f);
  }catch(e){res.status(500).json({error:e.message});}
});

router.delete('/:id', protect, async (req,res) => {
  try { await OutstandingFollowup.findByIdAndDelete(req.params.id); res.json({ok:true}); }
  catch(e){res.status(500).json({error:e.message});}
});

export default router;
