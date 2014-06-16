var _ = require('lodash');

/** Substitute parameters into all strings in JSON document */
module.exports = function(json, params) {

  var substr = function(str) {
    return str.replace(/{{([^}]*)}}/g, function(orig, id) {
      var value = params[id];
      return value !== undefined ? value : orig;
    });
  };

  var substitute = function(obj) {
    if (typeof(obj) == 'string') {
      return substr(obj);
    } else if (typeof(obj) == 'object') {
      if (obj instanceof Array) {
        return undefined;
      }
      var clone = {};
      for(var k in obj) {
        clone[substr(k)] = _.cloneDeep(obj[k], substitute);
      }
      return clone;
    }
  };

  return _.cloneDeep(json, substitute);
};

