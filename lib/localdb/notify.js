// lib/localdb/notify.js — سازگاری با کد قبلی؛ اعلان نظر جدید حالا از lib/adminAlert.js (چند ادمین) می‌رود.
const alert = require("../adminAlert");
function newMessage(row) { alert.comment(row); }
module.exports = { newMessage };
