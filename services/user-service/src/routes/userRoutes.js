// user.routes.js (placeholder)
const express = require('express');
const router = express.Router();

router.get('/:id', (req, res) => res.json({ message: 'get user' }));
router.put('/:id', (req, res) => res.json({ message: 'update user' }));

module.exports = router;
