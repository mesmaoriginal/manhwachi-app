// lib/localdb/errors.js
class HttpError extends Error {
  constructor(status, code, message, details = null, hint = null) {
    super(message);
    this.name = "HttpError"; this.status = status; this.code = code; this.details = details; this.hint = hint;
  }
}
module.exports = { HttpError };
