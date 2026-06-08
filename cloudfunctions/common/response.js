// cloudfunctions/common/response.js — 统一返回结构
function ok(data) {
  return { code: 200, data };
}
function fail(code, msg) {
  return { code, msg };
}
module.exports = { ok, fail };
