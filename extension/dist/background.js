var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// extension/src/ext-store.mjs
function createExtStore(initial = {}, persist = () => {
}) {
  const data = { ...initial };
  return {
    get(key) {
      return data[key];
    },
    set(patch) {
      Object.assign(data, patch);
      try {
        persist({ ...data });
      } catch {
      }
      return { ...data };
    },
    snapshot() {
      return { ...data };
    }
  };
}

// node_modules/js-yaml/dist/js-yaml.mjs
var __create = Object.create;
var __defProp2 = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
    key = keys[i];
    if (!__hasOwnProp.call(to, key) && key !== except) __defProp2(to, key, {
      get: ((k) => from[k]).bind(null, key),
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", {
  value: mod,
  enumerable: true
}) : target, mod));
var require_common = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  function isNothing(subject) {
    return typeof subject === "undefined" || subject === null;
  }
  function isObject2(subject) {
    return typeof subject === "object" && subject !== null;
  }
  function toArray(sequence) {
    if (Array.isArray(sequence)) return sequence;
    else if (isNothing(sequence)) return [];
    return [sequence];
  }
  function extend2(target, source) {
    if (source) {
      const sourceKeys = Object.keys(source);
      for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
        const key = sourceKeys[index];
        target[key] = source[key];
      }
    }
    return target;
  }
  function repeat(string4, count) {
    let result = "";
    for (let cycle = 0; cycle < count; cycle += 1) result += string4;
    return result;
  }
  function isNegativeZero(number4) {
    return number4 === 0 && Number.NEGATIVE_INFINITY === 1 / number4;
  }
  module.exports.isNothing = isNothing;
  module.exports.isObject = isObject2;
  module.exports.toArray = toArray;
  module.exports.repeat = repeat;
  module.exports.isNegativeZero = isNegativeZero;
  module.exports.extend = extend2;
}));
var require_exception = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  function formatError2(exception, compact) {
    let where = "";
    const message = exception.reason || "(unknown reason)";
    if (!exception.mark) return message;
    if (exception.mark.name) where += 'in "' + exception.mark.name + '" ';
    where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
    if (!compact && exception.mark.snippet) where += "\n\n" + exception.mark.snippet;
    return message + " " + where;
  }
  function YAMLException2(reason, mark) {
    Error.call(this);
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError2(this, false);
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
    else this.stack = (/* @__PURE__ */ new Error()).stack || "";
  }
  YAMLException2.prototype = Object.create(Error.prototype);
  YAMLException2.prototype.constructor = YAMLException2;
  YAMLException2.prototype.toString = function toString(compact) {
    return this.name + ": " + formatError2(this, compact);
  };
  module.exports = YAMLException2;
}));
var require_snippet = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var common = require_common();
  function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
    let head = "";
    let tail = "";
    const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
    if (position - lineStart > maxHalfLength) {
      head = " ... ";
      lineStart = position - maxHalfLength + head.length;
    }
    if (lineEnd - position > maxHalfLength) {
      tail = " ...";
      lineEnd = position + maxHalfLength - tail.length;
    }
    return {
      str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
      pos: position - lineStart + head.length
    };
  }
  function padStart(string4, max) {
    return common.repeat(" ", max - string4.length) + string4;
  }
  function makeSnippet(mark, options) {
    options = Object.create(options || null);
    if (!mark.buffer) return null;
    if (!options.maxLength) options.maxLength = 79;
    if (typeof options.indent !== "number") options.indent = 1;
    if (typeof options.linesBefore !== "number") options.linesBefore = 3;
    if (typeof options.linesAfter !== "number") options.linesAfter = 2;
    const re = /\r?\n|\r|\0/g;
    const lineStarts = [0];
    const lineEnds = [];
    let match;
    let foundLineNo = -1;
    while (match = re.exec(mark.buffer)) {
      lineEnds.push(match.index);
      lineStarts.push(match.index + match[0].length);
      if (mark.position <= match.index && foundLineNo < 0) foundLineNo = lineStarts.length - 2;
    }
    if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
    let result = "";
    const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
    const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
    for (let i = 1; i <= options.linesBefore; i++) {
      if (foundLineNo - i < 0) break;
      const line2 = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
      result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
    }
    const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
    result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
    result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
    for (let i = 1; i <= options.linesAfter; i++) {
      if (foundLineNo + i >= lineEnds.length) break;
      const line2 = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
      result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
    }
    return result.replace(/\n$/, "");
  }
  module.exports = makeSnippet;
}));
var require_type = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var YAMLException2 = require_exception();
  var TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  var YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function compileStyleAliases(map2) {
    const result = {};
    if (map2 !== null) Object.keys(map2).forEach(function(style) {
      map2[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
    return result;
  }
  function Type2(tag, options) {
    options = options || {};
    Object.keys(options).forEach(function(name) {
      if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) throw new YAMLException2('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    });
    this.options = options;
    this.tag = tag;
    this.kind = options["kind"] || null;
    this.resolve = options["resolve"] || function() {
      return true;
    };
    this.construct = options["construct"] || function(data) {
      return data;
    };
    this.instanceOf = options["instanceOf"] || null;
    this.predicate = options["predicate"] || null;
    this.represent = options["represent"] || null;
    this.representName = options["representName"] || null;
    this.defaultStyle = options["defaultStyle"] || null;
    this.multi = options["multi"] || false;
    this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
    if (YAML_NODE_KINDS.indexOf(this.kind) === -1) throw new YAMLException2('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
  module.exports = Type2;
}));
var require_schema = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var YAMLException2 = require_exception();
  var Type2 = require_type();
  function compileList(schema, name) {
    const result = [];
    schema[name].forEach(function(currentType) {
      let newIndex = result.length;
      result.forEach(function(previousType, previousIndex) {
        if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) newIndex = previousIndex;
      });
      result[newIndex] = currentType;
    });
    return result;
  }
  function compileMap() {
    const result = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    };
    function collectType(type) {
      if (type.multi) {
        result.multi[type.kind].push(type);
        result.multi["fallback"].push(type);
      } else result[type.kind][type.tag] = result["fallback"][type.tag] = type;
    }
    for (let index = 0, length = arguments.length; index < length; index += 1) arguments[index].forEach(collectType);
    return result;
  }
  function Schema2(definition) {
    return this.extend(definition);
  }
  Schema2.prototype.extend = function extend2(definition) {
    let implicit = [];
    let explicit = [];
    if (definition instanceof Type2) explicit.push(definition);
    else if (Array.isArray(definition)) explicit = explicit.concat(definition);
    else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit) implicit = implicit.concat(definition.implicit);
      if (definition.explicit) explicit = explicit.concat(definition.explicit);
    } else throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
    implicit.forEach(function(type) {
      if (!(type instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      if (type.loadKind && type.loadKind !== "scalar") throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      if (type.multi) throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    });
    explicit.forEach(function(type) {
      if (!(type instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    });
    const result = Object.create(Schema2.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  };
  module.exports = Schema2;
}));
var require_str = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  module.exports = new (require_type())("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(data) {
      return data !== null ? data : "";
    }
  });
}));
var require_seq = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  module.exports = new (require_type())("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(data) {
      return data !== null ? data : [];
    }
  });
}));
var require_map = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  module.exports = new (require_type())("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(data) {
      return data !== null ? data : {};
    }
  });
}));
var require_failsafe = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  module.exports = new (require_schema())({ explicit: [
    require_str(),
    require_seq(),
    require_map()
  ] });
}));
var require_null = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var Type2 = require_type();
  function resolveYamlNull(data) {
    if (data === null) return true;
    const max = data.length;
    return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
  }
  function constructYamlNull() {
    return null;
  }
  function isNull(object2) {
    return object2 === null;
  }
  module.exports = new Type2("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  });
}));
var require_bool = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var Type2 = require_type();
  function resolveYamlBoolean(data) {
    if (data === null) return false;
    const max = data.length;
    return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
  }
  function constructYamlBoolean(data) {
    return data === "true" || data === "True" || data === "TRUE";
  }
  function isBoolean(object2) {
    return Object.prototype.toString.call(object2) === "[object Boolean]";
  }
  module.exports = new Type2("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: function(object2) {
        return object2 ? "true" : "false";
      },
      uppercase: function(object2) {
        return object2 ? "TRUE" : "FALSE";
      },
      camelcase: function(object2) {
        return object2 ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  });
}));
var require_int = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var common = require_common();
  var Type2 = require_type();
  function isHexCode(c) {
    return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
  }
  function isOctCode(c) {
    return c >= 48 && c <= 55;
  }
  function isDecCode(c) {
    return c >= 48 && c <= 57;
  }
  function resolveYamlInteger(data) {
    if (data === null) return false;
    const max = data.length;
    let index = 0;
    let hasDigits = false;
    if (!max) return false;
    let ch = data[index];
    if (ch === "-" || ch === "+") ch = data[++index];
    if (ch === "0") {
      if (index + 1 === max) return true;
      ch = data[++index];
      if (ch === "b") {
        index++;
        for (; index < max; index++) {
          ch = data[index];
          if (ch !== "0" && ch !== "1") return false;
          hasDigits = true;
        }
        return hasDigits && Number.isFinite(parseYamlInteger(data));
      }
      if (ch === "x") {
        index++;
        for (; index < max; index++) {
          if (!isHexCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && Number.isFinite(parseYamlInteger(data));
      }
      if (ch === "o") {
        index++;
        for (; index < max; index++) {
          if (!isOctCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && Number.isFinite(parseYamlInteger(data));
      }
    }
    for (; index < max; index++) {
      if (!isDecCode(data.charCodeAt(index))) return false;
      hasDigits = true;
    }
    if (!hasDigits) return false;
    return Number.isFinite(parseYamlInteger(data));
  }
  function parseYamlInteger(data) {
    let value = data;
    let sign = 1;
    let ch = value[0];
    if (ch === "-" || ch === "+") {
      if (ch === "-") sign = -1;
      value = value.slice(1);
      ch = value[0];
    }
    if (value === "0") return 0;
    if (ch === "0") {
      if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
      if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
      if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
    }
    return sign * parseInt(value, 10);
  }
  function constructYamlInteger(data) {
    return parseYamlInteger(data);
  }
  function isInteger(object2) {
    return Object.prototype.toString.call(object2) === "[object Number]" && object2 % 1 === 0 && !common.isNegativeZero(object2);
  }
  module.exports = new Type2("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      },
      octal: function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      },
      decimal: function(obj) {
        return obj.toString(10);
      },
      hexadecimal: function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
}));
var require_float = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var common = require_common();
  var Type2 = require_type();
  var YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
  var YAML_FLOAT_SPECIAL_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
  function resolveYamlFloat(data) {
    if (data === null) return false;
    if (!YAML_FLOAT_PATTERN.test(data)) return false;
    if (Number.isFinite(parseFloat(data, 10))) return true;
    return YAML_FLOAT_SPECIAL_PATTERN.test(data);
  }
  function constructYamlFloat(data) {
    let value = data.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".indexOf(value[0]) >= 0) value = value.slice(1);
    if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    else if (value === ".nan") return NaN;
    return sign * parseFloat(value, 10);
  }
  var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  function representYamlFloat(object2, style) {
    if (isNaN(object2)) switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
    else if (Number.POSITIVE_INFINITY === object2) switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
    else if (Number.NEGATIVE_INFINITY === object2) switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
    else if (common.isNegativeZero(object2)) return "-0.0";
    const res = object2.toString(10);
    return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
  }
  function isFloat(object2) {
    return Object.prototype.toString.call(object2) === "[object Number]" && (object2 % 1 !== 0 || common.isNegativeZero(object2));
  }
  module.exports = new Type2("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
}));
var require_json = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  module.exports = require_failsafe().extend({ implicit: [
    require_null(),
    require_bool(),
    require_int(),
    require_float()
  ] });
}));
var require_core = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  module.exports = require_json();
}));
var require_timestamp = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var Type2 = require_type();
  var YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
  var YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
  function resolveYamlTimestamp(data) {
    if (data === null) return false;
    if (YAML_DATE_REGEXP.exec(data) !== null) return true;
    if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
    return false;
  }
  function constructYamlTimestamp(data) {
    let fraction = 0;
    let delta = null;
    let match = YAML_DATE_REGEXP.exec(data);
    if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
    if (match === null) throw new Error("Date resolve error");
    const year = +match[1];
    const month = +match[2] - 1;
    const day = +match[3];
    if (!match[4]) return new Date(Date.UTC(year, month, day));
    const hour = +match[4];
    const minute = +match[5];
    const second = +match[6];
    if (match[7]) {
      fraction = match[7].slice(0, 3);
      while (fraction.length < 3) fraction += "0";
      fraction = +fraction;
    }
    if (match[9]) {
      const tzHour = +match[10];
      const tzMinute = +(match[11] || 0);
      delta = (tzHour * 60 + tzMinute) * 6e4;
      if (match[9] === "-") delta = -delta;
    }
    const date5 = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
    if (delta) date5.setTime(date5.getTime() - delta);
    return date5;
  }
  function representYamlTimestamp(object2) {
    return object2.toISOString();
  }
  module.exports = new Type2("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
}));
var require_merge = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var Type2 = require_type();
  function resolveYamlMerge(data) {
    return data === "<<" || data === null;
  }
  module.exports = new Type2("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
}));
var require_binary = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var Type2 = require_type();
  var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
  function resolveYamlBinary(data) {
    if (data === null) return false;
    let bitlen = 0;
    const max = data.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      const code = map2.indexOf(data.charAt(idx));
      if (code > 64) continue;
      if (code < 0) return false;
      bitlen += 6;
    }
    return bitlen % 8 === 0;
  }
  function constructYamlBinary(data) {
    const input = data.replace(/[\r\n=]/g, "");
    const max = input.length;
    const map2 = BASE64_MAP;
    let bits = 0;
    const result = [];
    for (let idx = 0; idx < max; idx++) {
      if (idx % 4 === 0 && idx) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      }
      bits = bits << 6 | map2.indexOf(input.charAt(idx));
    }
    const tailbits = max % 4 * 6;
    if (tailbits === 0) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    } else if (tailbits === 18) {
      result.push(bits >> 10 & 255);
      result.push(bits >> 2 & 255);
    } else if (tailbits === 12) result.push(bits >> 4 & 255);
    return new Uint8Array(result);
  }
  function representYamlBinary(object2) {
    let result = "";
    let bits = 0;
    const max = object2.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      if (idx % 3 === 0 && idx) {
        result += map2[bits >> 18 & 63];
        result += map2[bits >> 12 & 63];
        result += map2[bits >> 6 & 63];
        result += map2[bits & 63];
      }
      bits = (bits << 8) + object2[idx];
    }
    const tail = max % 3;
    if (tail === 0) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    } else if (tail === 2) {
      result += map2[bits >> 10 & 63];
      result += map2[bits >> 4 & 63];
      result += map2[bits << 2 & 63];
      result += map2[64];
    } else if (tail === 1) {
      result += map2[bits >> 2 & 63];
      result += map2[bits << 4 & 63];
      result += map2[64];
      result += map2[64];
    }
    return result;
  }
  function isBinary(obj) {
    return Object.prototype.toString.call(obj) === "[object Uint8Array]";
  }
  module.exports = new Type2("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
}));
var require_omap = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var Type2 = require_type();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var _toString = Object.prototype.toString;
  function resolveYamlOmap(data) {
    if (data === null) return true;
    const objectKeys = [];
    const object2 = data;
    for (let index = 0, length = object2.length; index < length; index += 1) {
      const pair = object2[index];
      let pairHasKey = false;
      if (_toString.call(pair) !== "[object Object]") return false;
      let pairKey;
      for (pairKey in pair) if (_hasOwnProperty.call(pair, pairKey)) if (!pairHasKey) pairHasKey = true;
      else return false;
      if (!pairHasKey) return false;
      if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
      else return false;
    }
    return true;
  }
  function constructYamlOmap(data) {
    return data !== null ? data : [];
  }
  module.exports = new Type2("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
}));
var require_pairs = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var Type2 = require_type();
  var _toString = Object.prototype.toString;
  function resolveYamlPairs(data) {
    if (data === null) return true;
    const object2 = data;
    const result = new Array(object2.length);
    for (let index = 0, length = object2.length; index < length; index += 1) {
      const pair = object2[index];
      if (_toString.call(pair) !== "[object Object]") return false;
      const keys = Object.keys(pair);
      if (keys.length !== 1) return false;
      result[index] = [keys[0], pair[keys[0]]];
    }
    return true;
  }
  function constructYamlPairs(data) {
    if (data === null) return [];
    const object2 = data;
    const result = new Array(object2.length);
    for (let index = 0, length = object2.length; index < length; index += 1) {
      const pair = object2[index];
      const keys = Object.keys(pair);
      result[index] = [keys[0], pair[keys[0]]];
    }
    return result;
  }
  module.exports = new Type2("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
}));
var require_set = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var Type2 = require_type();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  function resolveYamlSet(data) {
    if (data === null) return true;
    const object2 = data;
    for (const key in object2) if (_hasOwnProperty.call(object2, key)) {
      if (object2[key] !== null) return false;
    }
    return true;
  }
  function constructYamlSet(data) {
    return data !== null ? data : {};
  }
  module.exports = new Type2("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
}));
var require_default = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  module.exports = require_core().extend({
    implicit: [require_timestamp(), require_merge()],
    explicit: [
      require_binary(),
      require_omap(),
      require_pairs(),
      require_set()
    ]
  });
}));
var require_loader = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var common = require_common();
  var YAMLException2 = require_exception();
  var makeSnippet = require_snippet();
  var DEFAULT_SCHEMA2 = require_default();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var CONTEXT_FLOW_IN = 1;
  var CONTEXT_FLOW_OUT = 2;
  var CONTEXT_BLOCK_IN = 3;
  var CONTEXT_BLOCK_OUT = 4;
  var CHOMPING_CLIP = 1;
  var CHOMPING_STRIP = 2;
  var CHOMPING_KEEP = 3;
  var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  var PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
  var PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
  var PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  function isEol(c) {
    return c === 10 || c === 13;
  }
  function isWhiteSpace(c) {
    return c === 9 || c === 32;
  }
  function isWsOrEol(c) {
    return c === 9 || c === 32 || c === 10 || c === 13;
  }
  function isFlowIndicator(c) {
    return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
  }
  function fromHexCode(c) {
    if (c >= 48 && c <= 57) return c - 48;
    const lc = c | 32;
    if (lc >= 97 && lc <= 102) return lc - 97 + 10;
    return -1;
  }
  function escapedHexLen(c) {
    if (c === 120) return 2;
    if (c === 117) return 4;
    if (c === 85) return 8;
    return 0;
  }
  function fromDecimalCode(c) {
    if (c >= 48 && c <= 57) return c - 48;
    return -1;
  }
  function simpleEscapeSequence(c) {
    switch (c) {
      case 48:
        return "\0";
      case 97:
        return "\x07";
      case 98:
        return "\b";
      case 116:
        return "	";
      case 9:
        return "	";
      case 110:
        return "\n";
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 114:
        return "\r";
      case 101:
        return "\x1B";
      case 32:
        return " ";
      case 34:
        return '"';
      case 47:
        return "/";
      case 92:
        return "\\";
      case 78:
        return "";
      case 95:
        return " ";
      case 76:
        return "\u2028";
      case 80:
        return "\u2029";
      default:
        return "";
    }
  }
  function charFromCodepoint(c) {
    if (c <= 65535) return String.fromCharCode(c);
    return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
  }
  function setProperty(object2, key, value) {
    if (key === "__proto__") Object.defineProperty(object2, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
    else object2[key] = value;
  }
  var simpleEscapeCheck = new Array(256);
  var simpleEscapeMap = new Array(256);
  for (let i = 0; i < 256; i++) {
    simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
    simpleEscapeMap[i] = simpleEscapeSequence(i);
  }
  function State(input, options) {
    this.input = input;
    this.filename = options["filename"] || null;
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.onWarning = options["onWarning"] || null;
    this.legacy = options["legacy"] || false;
    this.json = options["json"] || false;
    this.listener = options["listener"] || null;
    this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
    this.maxMergeSeqLength = typeof options["maxMergeSeqLength"] === "number" ? options["maxMergeSeqLength"] : 20;
    this.implicitTypes = this.schema.compiledImplicit;
    this.typeMap = this.schema.compiledTypeMap;
    this.length = input.length;
    this.position = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineIndent = 0;
    this.depth = 0;
    this.firstTabInLine = -1;
    this.documents = [];
    this.anchorMapTransactions = [];
  }
  function generateError(state, message) {
    const mark = {
      name: state.filename,
      buffer: state.input.slice(0, -1),
      position: state.position,
      line: state.line,
      column: state.position - state.lineStart
    };
    mark.snippet = makeSnippet(mark);
    return new YAMLException2(message, mark);
  }
  function throwError(state, message) {
    throw generateError(state, message);
  }
  function throwWarning(state, message) {
    if (state.onWarning) state.onWarning.call(null, generateError(state, message));
  }
  function storeAnchor(state, name, value) {
    const transactions = state.anchorMapTransactions;
    if (transactions.length !== 0) {
      const transaction = transactions[transactions.length - 1];
      if (!_hasOwnProperty.call(transaction, name)) transaction[name] = {
        existed: _hasOwnProperty.call(state.anchorMap, name),
        value: state.anchorMap[name]
      };
    }
    state.anchorMap[name] = value;
  }
  function beginAnchorTransaction(state) {
    state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
  }
  function commitAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const transactions = state.anchorMapTransactions;
    if (transactions.length === 0) return;
    const parent = transactions[transactions.length - 1];
    const names = Object.keys(transaction);
    for (let index = 0, length = names.length; index < length; index += 1) {
      const name = names[index];
      if (!_hasOwnProperty.call(parent, name)) parent[name] = transaction[name];
    }
  }
  function rollbackAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const names = Object.keys(transaction);
    for (let index = names.length - 1; index >= 0; index -= 1) {
      const entry = transaction[names[index]];
      if (entry.existed) state.anchorMap[names[index]] = entry.value;
      else delete state.anchorMap[names[index]];
    }
  }
  function snapshotState(state) {
    return {
      position: state.position,
      line: state.line,
      lineStart: state.lineStart,
      lineIndent: state.lineIndent,
      firstTabInLine: state.firstTabInLine,
      tag: state.tag,
      anchor: state.anchor,
      kind: state.kind,
      result: state.result
    };
  }
  function restoreState(state, snapshot) {
    state.position = snapshot.position;
    state.line = snapshot.line;
    state.lineStart = snapshot.lineStart;
    state.lineIndent = snapshot.lineIndent;
    state.firstTabInLine = snapshot.firstTabInLine;
    state.tag = snapshot.tag;
    state.anchor = snapshot.anchor;
    state.kind = snapshot.kind;
    state.result = snapshot.result;
  }
  var directiveHandlers = {
    YAML: function handleYamlDirective(state, name, args) {
      if (state.version !== null) throwError(state, "duplication of %YAML directive");
      if (args.length !== 1) throwError(state, "YAML directive accepts exactly one argument");
      const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null) throwError(state, "ill-formed argument of the YAML directive");
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major !== 1) throwError(state, "unacceptable YAML version of the document");
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2) throwWarning(state, "unsupported YAML version of the document");
    },
    TAG: function handleTagDirective(state, name, args) {
      let prefix;
      if (args.length !== 2) throwError(state, "TAG directive accepts exactly two arguments");
      const handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle)) throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      if (_hasOwnProperty.call(state.tagMap, handle)) throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      if (!PATTERN_TAG_URI.test(prefix)) throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }
  };
  function captureSegment(state, start, end, checkJson) {
    if (start < end) {
      const _result = state.input.slice(start, end);
      if (checkJson) for (let _position = 0, _length2 = _result.length; _position < _length2; _position += 1) {
        const _character = _result.charCodeAt(_position);
        if (!(_character === 9 || _character >= 32 && _character <= 1114111)) throwError(state, "expected valid JSON character");
      }
      else if (PATTERN_NON_PRINTABLE.test(_result)) throwError(state, "the stream contains non-printable characters");
      state.result += _result;
    }
  }
  function mergeMappings(state, destination, source, overridableKeys) {
    if (!common.isObject(source)) throwError(state, "cannot merge mappings; the provided source object is unacceptable");
    const sourceKeys = Object.keys(source);
    for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
      const key = sourceKeys[index];
      if (!_hasOwnProperty.call(destination, key)) {
        setProperty(destination, key, source[key]);
        overridableKeys[key] = true;
      }
    }
  }
  function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
    if (Array.isArray(keyNode)) {
      keyNode = Array.prototype.slice.call(keyNode);
      for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
        if (Array.isArray(keyNode[index])) throwError(state, "nested arrays are not supported inside keys");
        if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") keyNode[index] = "[object Object]";
      }
    }
    if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") keyNode = "[object Object]";
    keyNode = String(keyNode);
    if (_result === null) _result = {};
    if (keyTag === "tag:yaml.org,2002:merge") if (Array.isArray(valueNode)) {
      if (valueNode.length > state.maxMergeSeqLength) throwError(state, "merge sequence length exceeded maxMergeSeqLength (" + state.maxMergeSeqLength + ")");
      const seen = /* @__PURE__ */ new Set();
      for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
        const src = valueNode[index];
        if (seen.has(src)) continue;
        seen.add(src);
        mergeMappings(state, _result, src, overridableKeys);
      }
    } else mergeMappings(state, _result, valueNode, overridableKeys);
    else {
      if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
        state.line = startLine || state.line;
        state.lineStart = startLineStart || state.lineStart;
        state.position = startPos || state.position;
        throwError(state, "duplicated mapping key");
      }
      setProperty(_result, keyNode, valueNode);
      delete overridableKeys[keyNode];
    }
    return _result;
  }
  function readLineBreak(state) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 10) state.position++;
    else if (ch === 13) {
      state.position++;
      if (state.input.charCodeAt(state.position) === 10) state.position++;
    } else throwError(state, "a line break is expected");
    state.line += 1;
    state.lineStart = state.position;
    state.firstTabInLine = -1;
  }
  function skipSeparationSpace(state, allowComments, checkIndent) {
    let lineBreaks = 0;
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      while (isWhiteSpace(ch)) {
        if (ch === 9 && state.firstTabInLine === -1) state.firstTabInLine = state.position;
        ch = state.input.charCodeAt(++state.position);
      }
      if (allowComments && ch === 35) do
        ch = state.input.charCodeAt(++state.position);
      while (ch !== 10 && ch !== 13 && ch !== 0);
      if (isEol(ch)) {
        readLineBreak(state);
        ch = state.input.charCodeAt(state.position);
        lineBreaks++;
        state.lineIndent = 0;
        while (ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
      } else break;
    }
    if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) throwWarning(state, "deficient indentation");
    return lineBreaks;
  }
  function testDocumentSeparator(state) {
    let _position = state.position;
    let ch = state.input.charCodeAt(_position);
    if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
      _position += 3;
      ch = state.input.charCodeAt(_position);
      if (ch === 0 || isWsOrEol(ch)) return true;
    }
    return false;
  }
  function writeFoldedLines(state, count) {
    if (count === 1) state.result += " ";
    else if (count > 1) state.result += common.repeat("\n", count - 1);
  }
  function readPlainScalar(state, nodeIndent, withinFlowCollection) {
    let captureStart;
    let captureEnd;
    let hasPendingContent;
    let _line;
    let _lineStart;
    let _lineIndent;
    const _kind = state.kind;
    const _result = state.result;
    let ch = state.input.charCodeAt(state.position);
    if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) return false;
    if (ch === 63 || ch === 45) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) return false;
    }
    state.kind = "scalar";
    state.result = "";
    captureStart = captureEnd = state.position;
    hasPendingContent = false;
    while (ch !== 0) {
      if (ch === 58) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) break;
      } else if (ch === 35) {
        if (isWsOrEol(state.input.charCodeAt(state.position - 1))) break;
      } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) break;
      else if (isEol(ch)) {
        _line = state.line;
        _lineStart = state.lineStart;
        _lineIndent = state.lineIndent;
        skipSeparationSpace(state, false, -1);
        if (state.lineIndent >= nodeIndent) {
          hasPendingContent = true;
          ch = state.input.charCodeAt(state.position);
          continue;
        } else {
          state.position = captureEnd;
          state.line = _line;
          state.lineStart = _lineStart;
          state.lineIndent = _lineIndent;
          break;
        }
      }
      if (hasPendingContent) {
        captureSegment(state, captureStart, captureEnd, false);
        writeFoldedLines(state, state.line - _line);
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
      }
      if (!isWhiteSpace(ch)) captureEnd = state.position + 1;
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, captureEnd, false);
    if (state.result) return true;
    state.kind = _kind;
    state.result = _result;
    return false;
  }
  function readSingleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 39) return false;
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else return true;
    } else if (isEol(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a single quoted scalar");
    else {
      state.position++;
      if (!isWhiteSpace(ch)) captureEnd = state.position;
    }
    throwError(state, "unexpected end of the stream within a single quoted scalar");
  }
  function readDoubleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 34) return false;
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (isEol(ch)) skipSeparationSpace(state, false, nodeIndent);
      else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        let hexLength = tmp;
        let hexResult = 0;
        for (; hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) hexResult = (hexResult << 4) + tmp;
          else throwError(state, "expected hexadecimal character");
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else throwError(state, "unknown escape sequence");
      captureStart = captureEnd = state.position;
    } else if (isEol(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a double quoted scalar");
    else {
      state.position++;
      if (!isWhiteSpace(ch)) captureEnd = state.position;
    }
    throwError(state, "unexpected end of the stream within a double quoted scalar");
  }
  function readFlowCollection(state, nodeIndent) {
    let readNext = true;
    let _line;
    let _lineStart;
    let _pos;
    const _tag = state.tag;
    let _result;
    const _anchor = state.anchor;
    let terminator;
    let isPair;
    let isExplicitPair;
    let isMapping;
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyNode;
    let keyTag;
    let valueNode;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 91) {
      terminator = 93;
      isMapping = false;
      _result = [];
    } else if (ch === 123) {
      terminator = 125;
      isMapping = true;
      _result = {};
    } else return false;
    if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
    ch = state.input.charCodeAt(++state.position);
    while (ch !== 0) {
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === terminator) {
        state.position++;
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = isMapping ? "mapping" : "sequence";
        state.result = _result;
        return true;
      } else if (!readNext) throwError(state, "missed comma between flow collection entries");
      else if (ch === 44) throwError(state, "expected the node content, but found ','");
      keyTag = keyNode = valueNode = null;
      isPair = isExplicitPair = false;
      if (ch === 63) {
        if (isWsOrEol(state.input.charCodeAt(state.position + 1))) {
          isPair = isExplicitPair = true;
          state.position++;
          skipSeparationSpace(state, true, nodeIndent);
        }
      }
      _line = state.line;
      _lineStart = state.lineStart;
      _pos = state.position;
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      keyTag = state.tag;
      keyNode = state.result;
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if ((isExplicitPair || state.line === _line) && ch === 58) {
        isPair = true;
        ch = state.input.charCodeAt(++state.position);
        skipSeparationSpace(state, true, nodeIndent);
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        valueNode = state.result;
      }
      if (isMapping) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
      else if (isPair) _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
      else _result.push(keyNode);
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === 44) {
        readNext = true;
        ch = state.input.charCodeAt(++state.position);
      } else readNext = false;
    }
    throwError(state, "unexpected end of the stream within a flow collection");
  }
  function readBlockScalar(state, nodeIndent) {
    let folding;
    let chomping = CHOMPING_CLIP;
    let didReadContent = false;
    let detectedIndent = false;
    let textIndent = nodeIndent;
    let emptyLines = 0;
    let atMoreIndented = false;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 124) folding = false;
    else if (ch === 62) folding = true;
    else return false;
    state.kind = "scalar";
    state.result = "";
    while (ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
      if (ch === 43 || ch === 45) if (CHOMPING_CLIP === chomping) chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      else throwError(state, "repeat of a chomping mode identifier");
      else if ((tmp = fromDecimalCode(ch)) >= 0) if (tmp === 0) throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else throwError(state, "repeat of an indentation width identifier");
      else break;
    }
    if (isWhiteSpace(ch)) {
      do
        ch = state.input.charCodeAt(++state.position);
      while (isWhiteSpace(ch));
      if (ch === 35) do
        ch = state.input.charCodeAt(++state.position);
      while (!isEol(ch) && ch !== 0);
    }
    while (ch !== 0) {
      readLineBreak(state);
      state.lineIndent = 0;
      ch = state.input.charCodeAt(state.position);
      while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
      if (!detectedIndent && state.lineIndent > textIndent) textIndent = state.lineIndent;
      if (isEol(ch)) {
        emptyLines++;
        continue;
      }
      if (!detectedIndent && textIndent === 0) throwError(state, "missing indentation for block scalar");
      if (state.lineIndent < textIndent) {
        if (chomping === CHOMPING_KEEP) state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        else if (chomping === CHOMPING_CLIP) {
          if (didReadContent) state.result += "\n";
        }
        break;
      }
      if (folding) if (isWhiteSpace(ch)) {
        atMoreIndented = true;
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat("\n", emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) state.result += " ";
      } else state.result += common.repeat("\n", emptyLines);
      else state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      didReadContent = true;
      detectedIndent = true;
      emptyLines = 0;
      const captureStart = state.position;
      while (!isEol(ch) && ch !== 0) ch = state.input.charCodeAt(++state.position);
      captureSegment(state, captureStart, state.position, false);
    }
    return true;
  }
  function readBlockSequence(state, nodeIndent) {
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = [];
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (ch !== 45) break;
      if (!isWsOrEol(state.input.charCodeAt(state.position + 1))) break;
      detected = true;
      state.position++;
      if (skipSeparationSpace(state, true, -1)) {
        if (state.lineIndent <= nodeIndent) {
          _result.push(null);
          ch = state.input.charCodeAt(state.position);
          continue;
        }
      }
      const _line = state.line;
      composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
      _result.push(state.result);
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a sequence entry");
      else if (state.lineIndent < nodeIndent) break;
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "sequence";
      state.result = _result;
      return true;
    }
    return false;
  }
  function readBlockMapping(state, nodeIndent, flowIndent) {
    let allowCompact;
    let _keyLine;
    let _keyLineStart;
    let _keyPos;
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = {};
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyTag = null;
    let keyNode = null;
    let valueNode = null;
    let atExplicitKey = false;
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (!atExplicitKey && state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      const following = state.input.charCodeAt(state.position + 1);
      const _line = state.line;
      if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
        if (ch === 63) {
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = true;
          allowCompact = true;
        } else if (atExplicitKey) {
          atExplicitKey = false;
          allowCompact = true;
        } else throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
        state.position += 1;
        ch = following;
      } else {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
        if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) break;
        if (state.line === _line) {
          ch = state.input.charCodeAt(state.position);
          while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
          if (ch === 58) {
            ch = state.input.charCodeAt(++state.position);
            if (!isWsOrEol(ch)) throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = false;
            allowCompact = false;
            keyTag = state.tag;
            keyNode = state.result;
          } else if (detected) throwError(state, "can not read an implicit mapping pair; a colon is missed");
          else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else if (detected) throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
        else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      }
      if (state.line === _line || state.lineIndent > nodeIndent) {
        if (atExplicitKey) {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
        }
        if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) if (atExplicitKey) keyNode = state.result;
        else valueNode = state.result;
        if (!atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
      }
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a mapping entry");
      else if (state.lineIndent < nodeIndent) break;
    }
    if (atExplicitKey) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "mapping";
      state.result = _result;
    }
    return detected;
  }
  function readTagProperty(state) {
    let isVerbatim = false;
    let isNamed = false;
    let tagHandle;
    let tagName;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 33) return false;
    if (state.tag !== null) throwError(state, "duplication of a tag property");
    ch = state.input.charCodeAt(++state.position);
    if (ch === 60) {
      isVerbatim = true;
      ch = state.input.charCodeAt(++state.position);
    } else if (ch === 33) {
      isNamed = true;
      tagHandle = "!!";
      ch = state.input.charCodeAt(++state.position);
    } else tagHandle = "!";
    let _position = state.position;
    if (isVerbatim) {
      do
        ch = state.input.charCodeAt(++state.position);
      while (ch !== 0 && ch !== 62);
      if (state.position < state.length) {
        tagName = state.input.slice(_position, state.position);
        ch = state.input.charCodeAt(++state.position);
      } else throwError(state, "unexpected end of the stream within a verbatim tag");
    } else {
      while (ch !== 0 && !isWsOrEol(ch)) {
        if (ch === 33) if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) throwError(state, "named tag handle cannot contain such characters");
          isNamed = true;
          _position = state.position + 1;
        } else throwError(state, "tag suffix cannot contain exclamation marks");
        ch = state.input.charCodeAt(++state.position);
      }
      tagName = state.input.slice(_position, state.position);
      if (PATTERN_FLOW_INDICATORS.test(tagName)) throwError(state, "tag suffix cannot contain flow indicator characters");
    }
    if (tagName && !PATTERN_TAG_URI.test(tagName)) throwError(state, "tag name cannot contain such characters: " + tagName);
    try {
      tagName = decodeURIComponent(tagName);
    } catch (err) {
      throwError(state, "tag name is malformed: " + tagName);
    }
    if (isVerbatim) state.tag = tagName;
    else if (_hasOwnProperty.call(state.tagMap, tagHandle)) state.tag = state.tagMap[tagHandle] + tagName;
    else if (tagHandle === "!") state.tag = "!" + tagName;
    else if (tagHandle === "!!") state.tag = "tag:yaml.org,2002:" + tagName;
    else throwError(state, 'undeclared tag handle "' + tagHandle + '"');
    return true;
  }
  function readAnchorProperty(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 38) return false;
    if (state.anchor !== null) throwError(state, "duplication of an anchor property");
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
    if (state.position === _position) throwError(state, "name of an anchor node must contain at least one character");
    state.anchor = state.input.slice(_position, state.position);
    return true;
  }
  function readAlias(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 42) return false;
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
    if (state.position === _position) throwError(state, "name of an alias node must contain at least one character");
    const alias = state.input.slice(_position, state.position);
    if (!_hasOwnProperty.call(state.anchorMap, alias)) throwError(state, 'unidentified alias "' + alias + '"');
    state.result = state.anchorMap[alias];
    skipSeparationSpace(state, true, -1);
    return true;
  }
  function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
    const fallbackState = snapshotState(state);
    beginAnchorTransaction(state);
    restoreState(state, propertyStart);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
      commitAnchorTransaction(state);
      return true;
    }
    rollbackAnchorTransaction(state);
    restoreState(state, fallbackState);
    return false;
  }
  function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
    let allowBlockScalars;
    let allowBlockCollections;
    let indentStatus = 1;
    let atNewLine = false;
    let hasContent = false;
    let propertyStart = null;
    let type;
    let flowIndent;
    let blockIndent;
    if (state.depth >= state.maxDepth) throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
    state.depth += 1;
    if (state.listener !== null) state.listener("open", state);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
    if (allowToSeek) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        if (state.lineIndent > parentIndent) indentStatus = 1;
        else if (state.lineIndent === parentIndent) indentStatus = 0;
        else if (state.lineIndent < parentIndent) indentStatus = -1;
      }
    }
    if (indentStatus === 1) while (true) {
      const ch = state.input.charCodeAt(state.position);
      const propertyState = snapshotState(state);
      if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) break;
      if (!readTagProperty(state) && !readAnchorProperty(state)) break;
      if (propertyStart === null) propertyStart = propertyState;
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) indentStatus = 1;
        else if (state.lineIndent === parentIndent) indentStatus = 0;
        else if (state.lineIndent < parentIndent) indentStatus = -1;
      } else allowBlockCollections = false;
    }
    if (allowBlockCollections) allowBlockCollections = atNewLine || allowCompact;
    if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
      if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) flowIndent = parentIndent;
      else flowIndent = parentIndent + 1;
      blockIndent = state.position - state.lineStart;
      if (indentStatus === 1) if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) hasContent = true;
      else {
        const ch = state.input.charCodeAt(state.position);
        if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(state, propertyStart, propertyStart.position - propertyStart.lineStart, flowIndent)) hasContent = true;
        else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) hasContent = true;
        else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) throwError(state, "alias node should not have any properties");
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) state.tag = "?";
        }
        if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
      }
      else if (indentStatus === 0) hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
    if (state.tag === null) {
      if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
    } else if (state.tag === "?") {
      if (state.result !== null && state.kind !== "scalar") throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
      for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
        type = state.implicitTypes[typeIndex];
        if (type.resolve(state.result)) {
          state.result = type.construct(state.result);
          state.tag = type.tag;
          if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
          break;
        }
      }
    } else if (state.tag !== "!") {
      if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) type = state.typeMap[state.kind || "fallback"][state.tag];
      else {
        type = null;
        const typeList = state.typeMap.multi[state.kind || "fallback"];
        for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type = typeList[typeIndex];
          break;
        }
      }
      if (!type) throwError(state, "unknown tag !<" + state.tag + ">");
      if (state.result !== null && type.kind !== state.kind) throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
      if (!type.resolve(state.result, state.tag)) throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
      else {
        state.result = type.construct(state.result, state.tag);
        if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
      }
    }
    if (state.listener !== null) state.listener("close", state);
    state.depth -= 1;
    return state.tag !== null || state.anchor !== null || hasContent;
  }
  function readDocument(state) {
    const documentStart = state.position;
    let hasDirectives = false;
    let ch;
    state.version = null;
    state.checkLineBreaks = state.legacy;
    state.tagMap = /* @__PURE__ */ Object.create(null);
    state.anchorMap = /* @__PURE__ */ Object.create(null);
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if (state.lineIndent > 0 || ch !== 37) break;
      hasDirectives = true;
      ch = state.input.charCodeAt(++state.position);
      let _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
      const directiveName = state.input.slice(_position, state.position);
      const directiveArgs = [];
      if (directiveName.length < 1) throwError(state, "directive name must not be less than one character in length");
      while (ch !== 0) {
        while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
        if (ch === 35) {
          do
            ch = state.input.charCodeAt(++state.position);
          while (ch !== 0 && !isEol(ch));
          break;
        }
        if (isEol(ch)) break;
        _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
        directiveArgs.push(state.input.slice(_position, state.position));
      }
      if (ch !== 0) readLineBreak(state);
      if (_hasOwnProperty.call(directiveHandlers, directiveName)) directiveHandlers[directiveName](state, directiveName, directiveArgs);
      else throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
    skipSeparationSpace(state, true, -1);
    if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    } else if (hasDirectives) throwError(state, "directives end mark is expected");
    composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
    skipSeparationSpace(state, true, -1);
    if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) throwWarning(state, "non-ASCII line breaks are interpreted as content");
    state.documents.push(state.result);
    if (state.position === state.lineStart && testDocumentSeparator(state)) {
      if (state.input.charCodeAt(state.position) === 46) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      }
      return;
    }
    if (state.position < state.length - 1) throwError(state, "end of the stream or a document separator is expected");
  }
  function loadDocuments(input, options) {
    input = String(input);
    options = options || {};
    if (input.length !== 0) {
      if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) input += "\n";
      if (input.charCodeAt(0) === 65279) input = input.slice(1);
    }
    const state = new State(input, options);
    const nullpos = input.indexOf("\0");
    if (nullpos !== -1) {
      state.position = nullpos;
      throwError(state, "null byte is not allowed in input");
    }
    state.input += "\0";
    while (state.input.charCodeAt(state.position) === 32) {
      state.lineIndent += 1;
      state.position += 1;
    }
    while (state.position < state.length - 1) readDocument(state);
    return state.documents;
  }
  function loadAll2(input, iterator, options) {
    if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
      options = iterator;
      iterator = null;
    }
    const documents = loadDocuments(input, options);
    if (typeof iterator !== "function") return documents;
    for (let index = 0, length = documents.length; index < length; index += 1) iterator(documents[index]);
  }
  function load2(input, options) {
    const documents = loadDocuments(input, options);
    if (documents.length === 0) return;
    else if (documents.length === 1) return documents[0];
    throw new YAMLException2("expected a single document in the stream, but found more");
  }
  module.exports.loadAll = loadAll2;
  module.exports.load = load2;
}));
var require_dumper = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  var common = require_common();
  var YAMLException2 = require_exception();
  var DEFAULT_SCHEMA2 = require_default();
  var _toString = Object.prototype.toString;
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var CHAR_BOM = 65279;
  var CHAR_TAB = 9;
  var CHAR_LINE_FEED = 10;
  var CHAR_CARRIAGE_RETURN = 13;
  var CHAR_SPACE = 32;
  var CHAR_EXCLAMATION = 33;
  var CHAR_DOUBLE_QUOTE = 34;
  var CHAR_SHARP = 35;
  var CHAR_PERCENT = 37;
  var CHAR_AMPERSAND = 38;
  var CHAR_SINGLE_QUOTE = 39;
  var CHAR_ASTERISK = 42;
  var CHAR_COMMA = 44;
  var CHAR_MINUS = 45;
  var CHAR_COLON = 58;
  var CHAR_EQUALS = 61;
  var CHAR_GREATER_THAN = 62;
  var CHAR_QUESTION = 63;
  var CHAR_COMMERCIAL_AT = 64;
  var CHAR_LEFT_SQUARE_BRACKET = 91;
  var CHAR_RIGHT_SQUARE_BRACKET = 93;
  var CHAR_GRAVE_ACCENT = 96;
  var CHAR_LEFT_CURLY_BRACKET = 123;
  var CHAR_VERTICAL_LINE = 124;
  var CHAR_RIGHT_CURLY_BRACKET = 125;
  var ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = '\\"';
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  var DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function compileStyleMap(schema, map2) {
    if (map2 === null) return {};
    const result = {};
    const keys = Object.keys(map2);
    for (let index = 0, length = keys.length; index < length; index += 1) {
      let tag = keys[index];
      let style = String(map2[tag]);
      if (tag.slice(0, 2) === "!!") tag = "tag:yaml.org,2002:" + tag.slice(2);
      const type = schema.compiledTypeMap["fallback"][tag];
      if (type && _hasOwnProperty.call(type.styleAliases, style)) style = type.styleAliases[style];
      result[tag] = style;
    }
    return result;
  }
  function encodeHex(character) {
    let handle;
    let length;
    const string4 = character.toString(16).toUpperCase();
    if (character <= 255) {
      handle = "x";
      length = 2;
    } else if (character <= 65535) {
      handle = "u";
      length = 4;
    } else if (character <= 4294967295) {
      handle = "U";
      length = 8;
    } else throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
    return "\\" + handle + common.repeat("0", length - string4.length) + string4;
  }
  var QUOTING_TYPE_SINGLE = 1;
  var QUOTING_TYPE_DOUBLE = 2;
  function State(options) {
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.indent = Math.max(1, options["indent"] || 2);
    this.noArrayIndent = options["noArrayIndent"] || false;
    this.skipInvalid = options["skipInvalid"] || false;
    this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
    this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
    this.sortKeys = options["sortKeys"] || false;
    this.lineWidth = options["lineWidth"] || 80;
    this.noRefs = options["noRefs"] || false;
    this.noCompatMode = options["noCompatMode"] || false;
    this.condenseFlow = options["condenseFlow"] || false;
    this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
    this.forceQuotes = options["forceQuotes"] || false;
    this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.explicitTypes = this.schema.compiledExplicit;
    this.tag = null;
    this.result = "";
    this.duplicates = [];
    this.usedDuplicates = null;
  }
  function indentString(string4, spaces) {
    const ind = common.repeat(" ", spaces);
    let position = 0;
    let result = "";
    const length = string4.length;
    while (position < length) {
      let line;
      const next = string4.indexOf("\n", position);
      if (next === -1) {
        line = string4.slice(position);
        position = length;
      } else {
        line = string4.slice(position, next + 1);
        position = next + 1;
      }
      if (line.length && line !== "\n") result += ind;
      result += line;
    }
    return result;
  }
  function generateNextLine(state, level) {
    return "\n" + common.repeat(" ", state.indent * level);
  }
  function testImplicitResolving(state, str) {
    for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) if (state.implicitTypes[index].resolve(str)) return true;
    return false;
  }
  function isWhitespace(c) {
    return c === CHAR_SPACE || c === CHAR_TAB;
  }
  function isPrintable(c) {
    return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
  }
  function isNsCharOrWhitespace(c) {
    return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
  }
  function isPlainSafe(c, prev, inblock) {
    const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
    const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
    return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
  }
  function isPlainSafeFirst(c) {
    return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
  }
  function isPlainSafeLast(c) {
    return !isWhitespace(c) && c !== CHAR_COLON;
  }
  function codePointAt(string4, pos) {
    const first = string4.charCodeAt(pos);
    let second;
    if (first >= 55296 && first <= 56319 && pos + 1 < string4.length) {
      second = string4.charCodeAt(pos + 1);
      if (second >= 56320 && second <= 57343) return (first - 55296) * 1024 + second - 56320 + 65536;
    }
    return first;
  }
  function needIndentIndicator(string4) {
    return /^\n* /.test(string4);
  }
  var STYLE_PLAIN = 1;
  var STYLE_SINGLE = 2;
  var STYLE_LITERAL = 3;
  var STYLE_FOLDED = 4;
  var STYLE_DOUBLE = 5;
  function chooseScalarStyle(string4, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
    let i;
    let char = 0;
    let prevChar = null;
    let hasLineBreak = false;
    let hasFoldableLine = false;
    const shouldTrackWidth = lineWidth !== -1;
    let previousLineBreak = -1;
    let plain = isPlainSafeFirst(codePointAt(string4, 0)) && isPlainSafeLast(codePointAt(string4, string4.length - 1));
    if (singleLineOnly || forceQuotes) for (i = 0; i < string4.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string4, i);
      if (!isPrintable(char)) return STYLE_DOUBLE;
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    else {
      for (i = 0; i < string4.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string4, i);
        if (char === CHAR_LINE_FEED) {
          hasLineBreak = true;
          if (shouldTrackWidth) {
            hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string4[previousLineBreak + 1] !== " ";
            previousLineBreak = i;
          }
        } else if (!isPrintable(char)) return STYLE_DOUBLE;
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      hasFoldableLine = hasFoldableLine || shouldTrackWidth && i - previousLineBreak - 1 > lineWidth && string4[previousLineBreak + 1] !== " ";
    }
    if (!hasLineBreak && !hasFoldableLine) {
      if (plain && !forceQuotes && !testAmbiguousType(string4)) return STYLE_PLAIN;
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    if (indentPerLevel > 9 && needIndentIndicator(string4)) return STYLE_DOUBLE;
    if (!forceQuotes) return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  function writeScalar(state, string4, level, iskey, inblock) {
    state.dump = (function() {
      if (string4.length === 0) return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
      if (!state.noCompatMode) {
        if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string4) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string4)) return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string4 + '"' : "'" + string4 + "'";
      }
      const indent = state.indent * Math.max(1, level);
      const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
      const singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
      function testAmbiguity(string5) {
        return testImplicitResolving(state, string5);
      }
      switch (chooseScalarStyle(string4, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
        case STYLE_PLAIN:
          return string4;
        case STYLE_SINGLE:
          return "'" + string4.replace(/'/g, "''") + "'";
        case STYLE_LITERAL:
          return "|" + blockHeader(string4, state.indent) + dropEndingNewline(indentString(string4, indent));
        case STYLE_FOLDED:
          return ">" + blockHeader(string4, state.indent) + dropEndingNewline(indentString(foldString(string4, lineWidth), indent));
        case STYLE_DOUBLE:
          return '"' + escapeString(string4, lineWidth) + '"';
        default:
          throw new YAMLException2("impossible error: invalid scalar style");
      }
    })();
  }
  function blockHeader(string4, indentPerLevel) {
    const indentIndicator = needIndentIndicator(string4) ? String(indentPerLevel) : "";
    const clip2 = string4[string4.length - 1] === "\n";
    return indentIndicator + (clip2 && (string4[string4.length - 2] === "\n" || string4 === "\n") ? "+" : clip2 ? "" : "-") + "\n";
  }
  function dropEndingNewline(string4) {
    return string4[string4.length - 1] === "\n" ? string4.slice(0, -1) : string4;
  }
  function foldString(string4, width) {
    const lineRe = /(\n+)([^\n]*)/g;
    let result = (function() {
      let nextLF = string4.indexOf("\n");
      nextLF = nextLF !== -1 ? nextLF : string4.length;
      lineRe.lastIndex = nextLF;
      return foldLine(string4.slice(0, nextLF), width);
    })();
    let prevMoreIndented = string4[0] === "\n" || string4[0] === " ";
    let moreIndented;
    let match;
    while (match = lineRe.exec(string4)) {
      const prefix = match[1];
      const line = match[2];
      moreIndented = line[0] === " ";
      result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
      prevMoreIndented = moreIndented;
    }
    return result;
  }
  function foldLine(line, width) {
    if (line === "" || line[0] === " ") return line;
    const breakRe = / [^ ]/g;
    let match;
    let start = 0;
    let end;
    let curr = 0;
    let next = 0;
    let result = "";
    while (match = breakRe.exec(line)) {
      next = match.index;
      if (next - start > width) {
        end = curr > start ? curr : next;
        result += "\n" + line.slice(start, end);
        start = end + 1;
      }
      curr = next;
    }
    result += "\n";
    if (line.length - start > width && curr > start) result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
    else result += line.slice(start);
    return result.slice(1);
  }
  function escapeString(string4) {
    let result = "";
    let char = 0;
    for (let i = 0; i < string4.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string4, i);
      const escapeSeq = ESCAPE_SEQUENCES[char];
      if (!escapeSeq && isPrintable(char)) {
        result += string4[i];
        if (char >= 65536) result += string4[i + 1];
      } else result += escapeSeq || encodeHex(char);
    }
    return result;
  }
  function writeFlowSequence(state, level, object2) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object2.length; index < length; index += 1) {
      let value = object2[index];
      if (state.replacer) value = state.replacer.call(object2, String(index), value);
      if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
        if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = "[" + _result + "]";
  }
  function writeBlockSequence(state, level, object2, compact) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object2.length; index < length; index += 1) {
      let value = object2[index];
      if (state.replacer) value = state.replacer.call(object2, String(index), value);
      if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
        if (!compact || _result !== "") _result += generateNextLine(state, level);
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) _result += "-";
        else _result += "- ";
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = _result || "[]";
  }
  function writeFlowMapping(state, level, object2) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object2);
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (_result !== "") pairBuffer += ", ";
      if (state.condenseFlow) pairBuffer += '"';
      const objectKey = objectKeyList[index];
      let objectValue = object2[objectKey];
      if (state.replacer) objectValue = state.replacer.call(object2, objectKey, objectValue);
      if (!writeNode(state, level, objectKey, false, false)) continue;
      if (state.dump.length > 1024) pairBuffer += "? ";
      pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
      if (!writeNode(state, level, objectValue, false, false)) continue;
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = "{" + _result + "}";
  }
  function writeBlockMapping(state, level, object2, compact) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object2);
    if (state.sortKeys === true) objectKeyList.sort();
    else if (typeof state.sortKeys === "function") objectKeyList.sort(state.sortKeys);
    else if (state.sortKeys) throw new YAMLException2("sortKeys must be a boolean or a function");
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (!compact || _result !== "") pairBuffer += generateNextLine(state, level);
      const objectKey = objectKeyList[index];
      let objectValue = object2[objectKey];
      if (state.replacer) objectValue = state.replacer.call(object2, objectKey, objectValue);
      if (!writeNode(state, level + 1, objectKey, true, true, true)) continue;
      const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
      if (explicitPair) if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += "?";
      else pairBuffer += "? ";
      pairBuffer += state.dump;
      if (explicitPair) pairBuffer += generateNextLine(state, level);
      if (!writeNode(state, level + 1, objectValue, true, explicitPair)) continue;
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += ":";
      else pairBuffer += ": ";
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = _result || "{}";
  }
  function detectType(state, object2, explicit) {
    const typeList = explicit ? state.explicitTypes : state.implicitTypes;
    for (let index = 0, length = typeList.length; index < length; index += 1) {
      const type = typeList[index];
      if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object2 === "object" && object2 instanceof type.instanceOf) && (!type.predicate || type.predicate(object2))) {
        if (explicit) if (type.multi && type.representName) state.tag = type.representName(object2);
        else state.tag = type.tag;
        else state.tag = "?";
        if (type.represent) {
          const style = state.styleMap[type.tag] || type.defaultStyle;
          let _result;
          if (_toString.call(type.represent) === "[object Function]") _result = type.represent(object2, style);
          else if (_hasOwnProperty.call(type.represent, style)) _result = type.represent[style](object2, style);
          else throw new YAMLException2("!<" + type.tag + '> tag resolver accepts not "' + style + '" style');
          state.dump = _result;
        }
        return true;
      }
    }
    return false;
  }
  function writeNode(state, level, object2, block, compact, iskey, isblockseq) {
    state.tag = null;
    state.dump = object2;
    if (!detectType(state, object2, false)) detectType(state, object2, true);
    const type = _toString.call(state.dump);
    const inblock = block;
    if (block) block = state.flowLevel < 0 || state.flowLevel > level;
    const objectOrArray = type === "[object Object]" || type === "[object Array]";
    let duplicateIndex;
    let duplicate;
    if (objectOrArray) {
      duplicateIndex = state.duplicates.indexOf(object2);
      duplicate = duplicateIndex !== -1;
    }
    if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) compact = false;
    if (duplicate && state.usedDuplicates[duplicateIndex]) state.dump = "*ref_" + duplicateIndex;
    else {
      if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) state.usedDuplicates[duplicateIndex] = true;
      if (type === "[object Object]") if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
      }
      else if (type === "[object Array]") if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) writeBlockSequence(state, level - 1, state.dump, compact);
        else writeBlockSequence(state, level, state.dump, compact);
        if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
      }
      else if (type === "[object String]") {
        if (state.tag !== "?") writeScalar(state, state.dump, level, iskey, inblock);
      } else if (type === "[object Undefined]") return false;
      else {
        if (state.skipInvalid) return false;
        throw new YAMLException2("unacceptable kind of an object to dump " + type);
      }
      if (state.tag !== null && state.tag !== "?") {
        let tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
        if (state.tag[0] === "!") tagStr = "!" + tagStr;
        else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") tagStr = "!!" + tagStr.slice(18);
        else tagStr = "!<" + tagStr + ">";
        state.dump = tagStr + " " + state.dump;
      }
    }
    return true;
  }
  function getDuplicateReferences(object2, state) {
    const objects = [];
    const duplicatesIndexes = [];
    inspectNode(object2, objects, duplicatesIndexes);
    const length = duplicatesIndexes.length;
    for (let index = 0; index < length; index += 1) state.duplicates.push(objects[duplicatesIndexes[index]]);
    state.usedDuplicates = new Array(length);
  }
  function inspectNode(object2, objects, duplicatesIndexes) {
    if (object2 !== null && typeof object2 === "object") {
      const index = objects.indexOf(object2);
      if (index !== -1) {
        if (duplicatesIndexes.indexOf(index) === -1) duplicatesIndexes.push(index);
      } else {
        objects.push(object2);
        if (Array.isArray(object2)) for (let i = 0, length = object2.length; i < length; i += 1) inspectNode(object2[i], objects, duplicatesIndexes);
        else {
          const objectKeyList = Object.keys(object2);
          for (let i = 0, length = objectKeyList.length; i < length; i += 1) inspectNode(object2[objectKeyList[i]], objects, duplicatesIndexes);
        }
      }
    }
  }
  function dump2(input, options) {
    options = options || {};
    const state = new State(options);
    if (!state.noRefs) getDuplicateReferences(input, state);
    let value = input;
    if (state.replacer) value = state.replacer.call({ "": value }, "", value);
    if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
    return "";
  }
  module.exports.dump = dump2;
}));
var import_js_yaml = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
  var loader = require_loader();
  var dumper = require_dumper();
  function renamed(from, to) {
    return function() {
      throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
    };
  }
  module.exports.Type = require_type();
  module.exports.Schema = require_schema();
  module.exports.FAILSAFE_SCHEMA = require_failsafe();
  module.exports.JSON_SCHEMA = require_json();
  module.exports.CORE_SCHEMA = require_core();
  module.exports.DEFAULT_SCHEMA = require_default();
  module.exports.load = loader.load;
  module.exports.loadAll = loader.loadAll;
  module.exports.dump = dumper.dump;
  module.exports.YAMLException = require_exception();
  module.exports.types = {
    binary: require_binary(),
    float: require_float(),
    map: require_map(),
    null: require_null(),
    pairs: require_pairs(),
    set: require_set(),
    timestamp: require_timestamp(),
    bool: require_bool(),
    int: require_int(),
    merge: require_merge(),
    omap: require_omap(),
    seq: require_seq(),
    str: require_str()
  };
  module.exports.safeLoad = renamed("safeLoad", "load");
  module.exports.safeLoadAll = renamed("safeLoadAll", "loadAll");
  module.exports.safeDump = renamed("safeDump", "dump");
})))(), 1);
var { Type, Schema, FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, DEFAULT_SCHEMA, load, loadAll, dump, YAMLException, types, safeLoad, safeLoadAll, safeDump } = import_js_yaml.default;
var index_vite_proxy_tmp_default = import_js_yaml.default;

// node_modules/zod/v4/classic/external.js
var external_exports = {};
__export(external_exports, {
  $brand: () => $brand,
  $input: () => $input,
  $output: () => $output,
  NEVER: () => NEVER,
  TimePrecision: () => TimePrecision,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBase64: () => ZodBase64,
  ZodBase64URL: () => ZodBase64URL,
  ZodBigInt: () => ZodBigInt,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBoolean: () => ZodBoolean,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCUID: () => ZodCUID,
  ZodCUID2: () => ZodCUID2,
  ZodCatch: () => ZodCatch,
  ZodCodec: () => ZodCodec,
  ZodCustom: () => ZodCustom,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodE164: () => ZodE164,
  ZodEmail: () => ZodEmail,
  ZodEmoji: () => ZodEmoji,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodExactOptional: () => ZodExactOptional,
  ZodFile: () => ZodFile,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodGUID: () => ZodGUID,
  ZodIPv4: () => ZodIPv4,
  ZodIPv6: () => ZodIPv6,
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodJWT: () => ZodJWT,
  ZodKSUID: () => ZodKSUID,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMAC: () => ZodMAC,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNanoID: () => ZodNanoID,
  ZodNever: () => ZodNever,
  ZodNonOptional: () => ZodNonOptional,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodPipe: () => ZodPipe,
  ZodPrefault: () => ZodPrefault,
  ZodPreprocess: () => ZodPreprocess,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRealError: () => ZodRealError,
  ZodRecord: () => ZodRecord,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodStringFormat: () => ZodStringFormat,
  ZodSuccess: () => ZodSuccess,
  ZodSymbol: () => ZodSymbol,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodTransform: () => ZodTransform,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodULID: () => ZodULID,
  ZodURL: () => ZodURL,
  ZodUUID: () => ZodUUID,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  ZodXID: () => ZodXID,
  ZodXor: () => ZodXor,
  _ZodString: () => _ZodString,
  _default: () => _default2,
  _function: () => _function,
  any: () => any,
  array: () => array,
  base64: () => base642,
  base64url: () => base64url2,
  bigint: () => bigint2,
  boolean: () => boolean2,
  catch: () => _catch2,
  check: () => check,
  cidrv4: () => cidrv42,
  cidrv6: () => cidrv62,
  clone: () => clone,
  codec: () => codec,
  coerce: () => coerce_exports,
  config: () => config,
  core: () => core_exports2,
  cuid: () => cuid3,
  cuid2: () => cuid22,
  custom: () => custom,
  date: () => date3,
  decode: () => decode2,
  decodeAsync: () => decodeAsync2,
  describe: () => describe2,
  discriminatedUnion: () => discriminatedUnion,
  e164: () => e1642,
  email: () => email2,
  emoji: () => emoji2,
  encode: () => encode2,
  encodeAsync: () => encodeAsync2,
  endsWith: () => _endsWith,
  enum: () => _enum2,
  exactOptional: () => exactOptional,
  file: () => file,
  flattenError: () => flattenError,
  float32: () => float32,
  float64: () => float64,
  formatError: () => formatError,
  fromJSONSchema: () => fromJSONSchema,
  function: () => _function,
  getErrorMap: () => getErrorMap,
  globalRegistry: () => globalRegistry,
  gt: () => _gt,
  gte: () => _gte,
  guid: () => guid2,
  hash: () => hash,
  hex: () => hex2,
  hostname: () => hostname2,
  httpUrl: () => httpUrl,
  includes: () => _includes,
  instanceof: () => _instanceof,
  int: () => int,
  int32: () => int32,
  int64: () => int64,
  intersection: () => intersection,
  invertCodec: () => invertCodec,
  ipv4: () => ipv42,
  ipv6: () => ipv62,
  iso: () => iso_exports,
  json: () => json,
  jwt: () => jwt,
  keyof: () => keyof,
  ksuid: () => ksuid2,
  lazy: () => lazy,
  length: () => _length,
  literal: () => literal,
  locales: () => locales_exports,
  looseObject: () => looseObject,
  looseRecord: () => looseRecord,
  lowercase: () => _lowercase,
  lt: () => _lt,
  lte: () => _lte,
  mac: () => mac2,
  map: () => map,
  maxLength: () => _maxLength,
  maxSize: () => _maxSize,
  meta: () => meta2,
  mime: () => _mime,
  minLength: () => _minLength,
  minSize: () => _minSize,
  multipleOf: () => _multipleOf,
  nan: () => nan,
  nanoid: () => nanoid2,
  nativeEnum: () => nativeEnum,
  negative: () => _negative,
  never: () => never,
  nonnegative: () => _nonnegative,
  nonoptional: () => nonoptional,
  nonpositive: () => _nonpositive,
  normalize: () => _normalize,
  null: () => _null3,
  nullable: () => nullable,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional,
  overwrite: () => _overwrite,
  parse: () => parse2,
  parseAsync: () => parseAsync2,
  partialRecord: () => partialRecord,
  pipe: () => pipe,
  positive: () => _positive,
  prefault: () => prefault,
  preprocess: () => preprocess,
  prettifyError: () => prettifyError,
  promise: () => promise,
  property: () => _property,
  readonly: () => readonly,
  record: () => record,
  refine: () => refine,
  regex: () => _regex,
  regexes: () => regexes_exports,
  registry: () => registry,
  safeDecode: () => safeDecode2,
  safeDecodeAsync: () => safeDecodeAsync2,
  safeEncode: () => safeEncode2,
  safeEncodeAsync: () => safeEncodeAsync2,
  safeParse: () => safeParse2,
  safeParseAsync: () => safeParseAsync2,
  set: () => set,
  setErrorMap: () => setErrorMap,
  size: () => _size,
  slugify: () => _slugify,
  startsWith: () => _startsWith,
  strictObject: () => strictObject,
  string: () => string2,
  stringFormat: () => stringFormat,
  stringbool: () => stringbool,
  success: () => success,
  superRefine: () => superRefine,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  toJSONSchema: () => toJSONSchema,
  toLowerCase: () => _toLowerCase,
  toUpperCase: () => _toUpperCase,
  transform: () => transform,
  treeifyError: () => treeifyError,
  trim: () => _trim,
  tuple: () => tuple,
  uint32: () => uint32,
  uint64: () => uint64,
  ulid: () => ulid2,
  undefined: () => _undefined3,
  union: () => union,
  unknown: () => unknown,
  uppercase: () => _uppercase,
  url: () => url,
  util: () => util_exports,
  uuid: () => uuid2,
  uuidv4: () => uuidv4,
  uuidv6: () => uuidv6,
  uuidv7: () => uuidv7,
  void: () => _void2,
  xid: () => xid2,
  xor: () => xor
});

// node_modules/zod/v4/core/index.js
var core_exports2 = {};
__export(core_exports2, {
  $ZodAny: () => $ZodAny,
  $ZodArray: () => $ZodArray,
  $ZodAsyncError: () => $ZodAsyncError,
  $ZodBase64: () => $ZodBase64,
  $ZodBase64URL: () => $ZodBase64URL,
  $ZodBigInt: () => $ZodBigInt,
  $ZodBigIntFormat: () => $ZodBigIntFormat,
  $ZodBoolean: () => $ZodBoolean,
  $ZodCIDRv4: () => $ZodCIDRv4,
  $ZodCIDRv6: () => $ZodCIDRv6,
  $ZodCUID: () => $ZodCUID,
  $ZodCUID2: () => $ZodCUID2,
  $ZodCatch: () => $ZodCatch,
  $ZodCheck: () => $ZodCheck,
  $ZodCheckBigIntFormat: () => $ZodCheckBigIntFormat,
  $ZodCheckEndsWith: () => $ZodCheckEndsWith,
  $ZodCheckGreaterThan: () => $ZodCheckGreaterThan,
  $ZodCheckIncludes: () => $ZodCheckIncludes,
  $ZodCheckLengthEquals: () => $ZodCheckLengthEquals,
  $ZodCheckLessThan: () => $ZodCheckLessThan,
  $ZodCheckLowerCase: () => $ZodCheckLowerCase,
  $ZodCheckMaxLength: () => $ZodCheckMaxLength,
  $ZodCheckMaxSize: () => $ZodCheckMaxSize,
  $ZodCheckMimeType: () => $ZodCheckMimeType,
  $ZodCheckMinLength: () => $ZodCheckMinLength,
  $ZodCheckMinSize: () => $ZodCheckMinSize,
  $ZodCheckMultipleOf: () => $ZodCheckMultipleOf,
  $ZodCheckNumberFormat: () => $ZodCheckNumberFormat,
  $ZodCheckOverwrite: () => $ZodCheckOverwrite,
  $ZodCheckProperty: () => $ZodCheckProperty,
  $ZodCheckRegex: () => $ZodCheckRegex,
  $ZodCheckSizeEquals: () => $ZodCheckSizeEquals,
  $ZodCheckStartsWith: () => $ZodCheckStartsWith,
  $ZodCheckStringFormat: () => $ZodCheckStringFormat,
  $ZodCheckUpperCase: () => $ZodCheckUpperCase,
  $ZodCodec: () => $ZodCodec,
  $ZodCustom: () => $ZodCustom,
  $ZodCustomStringFormat: () => $ZodCustomStringFormat,
  $ZodDate: () => $ZodDate,
  $ZodDefault: () => $ZodDefault,
  $ZodDiscriminatedUnion: () => $ZodDiscriminatedUnion,
  $ZodE164: () => $ZodE164,
  $ZodEmail: () => $ZodEmail,
  $ZodEmoji: () => $ZodEmoji,
  $ZodEncodeError: () => $ZodEncodeError,
  $ZodEnum: () => $ZodEnum,
  $ZodError: () => $ZodError,
  $ZodExactOptional: () => $ZodExactOptional,
  $ZodFile: () => $ZodFile,
  $ZodFunction: () => $ZodFunction,
  $ZodGUID: () => $ZodGUID,
  $ZodIPv4: () => $ZodIPv4,
  $ZodIPv6: () => $ZodIPv6,
  $ZodISODate: () => $ZodISODate,
  $ZodISODateTime: () => $ZodISODateTime,
  $ZodISODuration: () => $ZodISODuration,
  $ZodISOTime: () => $ZodISOTime,
  $ZodIntersection: () => $ZodIntersection,
  $ZodJWT: () => $ZodJWT,
  $ZodKSUID: () => $ZodKSUID,
  $ZodLazy: () => $ZodLazy,
  $ZodLiteral: () => $ZodLiteral,
  $ZodMAC: () => $ZodMAC,
  $ZodMap: () => $ZodMap,
  $ZodNaN: () => $ZodNaN,
  $ZodNanoID: () => $ZodNanoID,
  $ZodNever: () => $ZodNever,
  $ZodNonOptional: () => $ZodNonOptional,
  $ZodNull: () => $ZodNull,
  $ZodNullable: () => $ZodNullable,
  $ZodNumber: () => $ZodNumber,
  $ZodNumberFormat: () => $ZodNumberFormat,
  $ZodObject: () => $ZodObject,
  $ZodObjectJIT: () => $ZodObjectJIT,
  $ZodOptional: () => $ZodOptional,
  $ZodPipe: () => $ZodPipe,
  $ZodPrefault: () => $ZodPrefault,
  $ZodPreprocess: () => $ZodPreprocess,
  $ZodPromise: () => $ZodPromise,
  $ZodReadonly: () => $ZodReadonly,
  $ZodRealError: () => $ZodRealError,
  $ZodRecord: () => $ZodRecord,
  $ZodRegistry: () => $ZodRegistry,
  $ZodSet: () => $ZodSet,
  $ZodString: () => $ZodString,
  $ZodStringFormat: () => $ZodStringFormat,
  $ZodSuccess: () => $ZodSuccess,
  $ZodSymbol: () => $ZodSymbol,
  $ZodTemplateLiteral: () => $ZodTemplateLiteral,
  $ZodTransform: () => $ZodTransform,
  $ZodTuple: () => $ZodTuple,
  $ZodType: () => $ZodType,
  $ZodULID: () => $ZodULID,
  $ZodURL: () => $ZodURL,
  $ZodUUID: () => $ZodUUID,
  $ZodUndefined: () => $ZodUndefined,
  $ZodUnion: () => $ZodUnion,
  $ZodUnknown: () => $ZodUnknown,
  $ZodVoid: () => $ZodVoid,
  $ZodXID: () => $ZodXID,
  $ZodXor: () => $ZodXor,
  $brand: () => $brand,
  $constructor: () => $constructor,
  $input: () => $input,
  $output: () => $output,
  Doc: () => Doc,
  JSONSchema: () => json_schema_exports,
  JSONSchemaGenerator: () => JSONSchemaGenerator,
  NEVER: () => NEVER,
  TimePrecision: () => TimePrecision,
  _any: () => _any,
  _array: () => _array,
  _base64: () => _base64,
  _base64url: () => _base64url,
  _bigint: () => _bigint,
  _boolean: () => _boolean,
  _catch: () => _catch,
  _check: () => _check,
  _cidrv4: () => _cidrv4,
  _cidrv6: () => _cidrv6,
  _coercedBigint: () => _coercedBigint,
  _coercedBoolean: () => _coercedBoolean,
  _coercedDate: () => _coercedDate,
  _coercedNumber: () => _coercedNumber,
  _coercedString: () => _coercedString,
  _cuid: () => _cuid,
  _cuid2: () => _cuid2,
  _custom: () => _custom,
  _date: () => _date,
  _decode: () => _decode,
  _decodeAsync: () => _decodeAsync,
  _default: () => _default,
  _discriminatedUnion: () => _discriminatedUnion,
  _e164: () => _e164,
  _email: () => _email,
  _emoji: () => _emoji2,
  _encode: () => _encode,
  _encodeAsync: () => _encodeAsync,
  _endsWith: () => _endsWith,
  _enum: () => _enum,
  _file: () => _file,
  _float32: () => _float32,
  _float64: () => _float64,
  _gt: () => _gt,
  _gte: () => _gte,
  _guid: () => _guid,
  _includes: () => _includes,
  _int: () => _int,
  _int32: () => _int32,
  _int64: () => _int64,
  _intersection: () => _intersection,
  _ipv4: () => _ipv4,
  _ipv6: () => _ipv6,
  _isoDate: () => _isoDate,
  _isoDateTime: () => _isoDateTime,
  _isoDuration: () => _isoDuration,
  _isoTime: () => _isoTime,
  _jwt: () => _jwt,
  _ksuid: () => _ksuid,
  _lazy: () => _lazy,
  _length: () => _length,
  _literal: () => _literal,
  _lowercase: () => _lowercase,
  _lt: () => _lt,
  _lte: () => _lte,
  _mac: () => _mac,
  _map: () => _map,
  _max: () => _lte,
  _maxLength: () => _maxLength,
  _maxSize: () => _maxSize,
  _mime: () => _mime,
  _min: () => _gte,
  _minLength: () => _minLength,
  _minSize: () => _minSize,
  _multipleOf: () => _multipleOf,
  _nan: () => _nan,
  _nanoid: () => _nanoid,
  _nativeEnum: () => _nativeEnum,
  _negative: () => _negative,
  _never: () => _never,
  _nonnegative: () => _nonnegative,
  _nonoptional: () => _nonoptional,
  _nonpositive: () => _nonpositive,
  _normalize: () => _normalize,
  _null: () => _null2,
  _nullable: () => _nullable,
  _number: () => _number,
  _optional: () => _optional,
  _overwrite: () => _overwrite,
  _parse: () => _parse,
  _parseAsync: () => _parseAsync,
  _pipe: () => _pipe,
  _positive: () => _positive,
  _promise: () => _promise,
  _property: () => _property,
  _readonly: () => _readonly,
  _record: () => _record,
  _refine: () => _refine,
  _regex: () => _regex,
  _safeDecode: () => _safeDecode,
  _safeDecodeAsync: () => _safeDecodeAsync,
  _safeEncode: () => _safeEncode,
  _safeEncodeAsync: () => _safeEncodeAsync,
  _safeParse: () => _safeParse,
  _safeParseAsync: () => _safeParseAsync,
  _set: () => _set,
  _size: () => _size,
  _slugify: () => _slugify,
  _startsWith: () => _startsWith,
  _string: () => _string,
  _stringFormat: () => _stringFormat,
  _stringbool: () => _stringbool,
  _success: () => _success,
  _superRefine: () => _superRefine,
  _symbol: () => _symbol,
  _templateLiteral: () => _templateLiteral,
  _toLowerCase: () => _toLowerCase,
  _toUpperCase: () => _toUpperCase,
  _transform: () => _transform,
  _trim: () => _trim,
  _tuple: () => _tuple,
  _uint32: () => _uint32,
  _uint64: () => _uint64,
  _ulid: () => _ulid,
  _undefined: () => _undefined2,
  _union: () => _union,
  _unknown: () => _unknown,
  _uppercase: () => _uppercase,
  _url: () => _url,
  _uuid: () => _uuid,
  _uuidv4: () => _uuidv4,
  _uuidv6: () => _uuidv6,
  _uuidv7: () => _uuidv7,
  _void: () => _void,
  _xid: () => _xid,
  _xor: () => _xor,
  clone: () => clone,
  config: () => config,
  createStandardJSONSchemaMethod: () => createStandardJSONSchemaMethod,
  createToJSONSchemaMethod: () => createToJSONSchemaMethod,
  decode: () => decode,
  decodeAsync: () => decodeAsync,
  describe: () => describe,
  encode: () => encode,
  encodeAsync: () => encodeAsync,
  extractDefs: () => extractDefs,
  finalize: () => finalize,
  flattenError: () => flattenError,
  formatError: () => formatError,
  globalConfig: () => globalConfig,
  globalRegistry: () => globalRegistry,
  initializeContext: () => initializeContext,
  isValidBase64: () => isValidBase64,
  isValidBase64URL: () => isValidBase64URL,
  isValidJWT: () => isValidJWT,
  locales: () => locales_exports,
  meta: () => meta,
  parse: () => parse,
  parseAsync: () => parseAsync,
  prettifyError: () => prettifyError,
  process: () => process,
  regexes: () => regexes_exports,
  registry: () => registry,
  safeDecode: () => safeDecode,
  safeDecodeAsync: () => safeDecodeAsync,
  safeEncode: () => safeEncode,
  safeEncodeAsync: () => safeEncodeAsync,
  safeParse: () => safeParse,
  safeParseAsync: () => safeParseAsync,
  toDotPath: () => toDotPath,
  toJSONSchema: () => toJSONSchema,
  treeifyError: () => treeifyError,
  util: () => util_exports,
  version: () => version
});

// node_modules/zod/v4/core/core.js
var _a;
var NEVER = /* @__PURE__ */ Object.freeze({
  status: "aborted"
});
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: /* @__PURE__ */ new Set()
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a3;
    const inst = params?.Parent ? new Definition() : this;
    init(inst, def);
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = /* @__PURE__ */ Symbol("zod_brand");
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set2 = false;
  return {
    get value() {
      if (!set2) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class2, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class2 ? new Class2({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class2 ? new Class2({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class2, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class2({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class2({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base643) {
  const binaryString = atob(base643);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url3) {
  const base643 = base64url3.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base643.length % 4) % 4);
  return base64ToUint8Array(base643 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex3) {
  const cleanHex = hex3.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Class = class {
  constructor(..._args) {
  }
};

// node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error51, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error51.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error51, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error52, path = []) => {
    for (const issue2 of error52.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error51);
  return fieldErrors;
}
function treeifyError(error51, mapper = (issue2) => issue2.message) {
  const result = { errors: [] };
  const processError = (error52, path = []) => {
    var _a3, _b;
    for (const issue2 of error52.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          result.errors.push(mapper(issue2));
          continue;
        }
        let curr = result;
        let i = 0;
        while (i < fullpath.length) {
          const el = fullpath[i];
          const terminal = i === fullpath.length - 1;
          if (typeof el === "string") {
            curr.properties ?? (curr.properties = {});
            (_a3 = curr.properties)[el] ?? (_a3[el] = { errors: [] });
            curr = curr.properties[el];
          } else {
            curr.items ?? (curr.items = []);
            (_b = curr.items)[el] ?? (_b[el] = { errors: [] });
            curr = curr.items[el];
          }
          if (terminal) {
            curr.errors.push(mapper(issue2));
          }
          i++;
        }
      }
    }
  };
  processError(error51);
  return result;
}
function toDotPath(_path) {
  const segs = [];
  const path = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
  for (const seg of path) {
    if (typeof seg === "number")
      segs.push(`[${seg}]`);
    else if (typeof seg === "symbol")
      segs.push(`[${JSON.stringify(String(seg))}]`);
    else if (/[^\w$]/.test(seg))
      segs.push(`[${JSON.stringify(seg)}]`);
    else {
      if (segs.length)
        segs.push(".");
      segs.push(seg);
    }
  }
  return segs.join("");
}
function prettifyError(error51) {
  const lines = [];
  const issues = [...error51.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
  for (const issue2 of issues) {
    lines.push(`✖ ${issue2.message}`);
    if (issue2.path?.length)
      lines.push(`  → at ${toDotPath(issue2.path)}`);
  }
  return lines.join("\n");
}

// node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var parse = /* @__PURE__ */ _parse($ZodRealError);
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var encode = /* @__PURE__ */ _encode($ZodRealError);
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var decode = /* @__PURE__ */ _decode($ZodRealError);
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var encodeAsync = /* @__PURE__ */ _encodeAsync($ZodRealError);
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var decodeAsync = /* @__PURE__ */ _decodeAsync($ZodRealError);
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var safeEncode = /* @__PURE__ */ _safeEncode($ZodRealError);
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var safeDecode = /* @__PURE__ */ _safeDecode($ZodRealError);
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync($ZodRealError);
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync($ZodRealError);

// node_modules/zod/v4/core/regexes.js
var regexes_exports = {};
__export(regexes_exports, {
  base64: () => base64,
  base64url: () => base64url,
  bigint: () => bigint,
  boolean: () => boolean,
  browserEmail: () => browserEmail,
  cidrv4: () => cidrv4,
  cidrv6: () => cidrv6,
  cuid: () => cuid,
  cuid2: () => cuid2,
  date: () => date,
  datetime: () => datetime,
  domain: () => domain,
  duration: () => duration,
  e164: () => e164,
  email: () => email,
  emoji: () => emoji,
  extendedDuration: () => extendedDuration,
  guid: () => guid,
  hex: () => hex,
  hostname: () => hostname,
  html5Email: () => html5Email,
  httpProtocol: () => httpProtocol,
  idnEmail: () => idnEmail,
  integer: () => integer,
  ipv4: () => ipv4,
  ipv6: () => ipv6,
  ksuid: () => ksuid,
  lowercase: () => lowercase,
  mac: () => mac,
  md5_base64: () => md5_base64,
  md5_base64url: () => md5_base64url,
  md5_hex: () => md5_hex,
  nanoid: () => nanoid,
  null: () => _null,
  number: () => number,
  rfc5322Email: () => rfc5322Email,
  sha1_base64: () => sha1_base64,
  sha1_base64url: () => sha1_base64url,
  sha1_hex: () => sha1_hex,
  sha256_base64: () => sha256_base64,
  sha256_base64url: () => sha256_base64url,
  sha256_hex: () => sha256_hex,
  sha384_base64: () => sha384_base64,
  sha384_base64url: () => sha384_base64url,
  sha384_hex: () => sha384_hex,
  sha512_base64: () => sha512_base64,
  sha512_base64url: () => sha512_base64url,
  sha512_hex: () => sha512_hex,
  string: () => string,
  time: () => time,
  ulid: () => ulid,
  undefined: () => _undefined,
  unicodeEmail: () => unicodeEmail,
  uppercase: () => uppercase,
  uuid: () => uuid,
  uuid4: () => uuid4,
  uuid6: () => uuid6,
  uuid7: () => uuid7,
  xid: () => xid
});
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var extendedDuration = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var uuid4 = /* @__PURE__ */ uuid(4);
var uuid6 = /* @__PURE__ */ uuid(6);
var uuid7 = /* @__PURE__ */ uuid(7);
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var html5Email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var rfc5322Email = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
var unicodeEmail = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
var idnEmail = unicodeEmail;
var browserEmail = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var mac = (delimiter) => {
  const escapedDelim = escapeRegex(delimiter ?? ":");
  return new RegExp(`^(?:[0-9A-F]{2}${escapedDelim}){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}${escapedDelim}){5}[0-9a-f]{2}$`);
};
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
var domain = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time3 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time3}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var bigint = /^-?\d+n?$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var _null = /^null$/i;
var _undefined = /^undefined$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
var hex = /^[0-9a-fA-F]*$/;
function fixedBase64(bodyLength, padding) {
  return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
}
function fixedBase64url(length) {
  return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}
var md5_hex = /^[0-9a-fA-F]{32}$/;
var md5_base64 = /* @__PURE__ */ fixedBase64(22, "==");
var md5_base64url = /* @__PURE__ */ fixedBase64url(22);
var sha1_hex = /^[0-9a-fA-F]{40}$/;
var sha1_base64 = /* @__PURE__ */ fixedBase64(27, "=");
var sha1_base64url = /* @__PURE__ */ fixedBase64url(27);
var sha256_hex = /^[0-9a-fA-F]{64}$/;
var sha256_base64 = /* @__PURE__ */ fixedBase64(43, "=");
var sha256_base64url = /* @__PURE__ */ fixedBase64url(43);
var sha384_hex = /^[0-9a-fA-F]{96}$/;
var sha384_base64 = /* @__PURE__ */ fixedBase64(64, "");
var sha384_base64url = /* @__PURE__ */ fixedBase64url(64);
var sha512_hex = /^[0-9a-fA-F]{128}$/;
var sha512_base64 = /* @__PURE__ */ fixedBase64(86, "==");
var sha512_base64url = /* @__PURE__ */ fixedBase64url(86);

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a3;
    (_a3 = inst2._zod.bag).multipleOf ?? (_a3.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckBigIntFormat = /* @__PURE__ */ $constructor("$ZodCheckBigIntFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  const [minimum, maximum] = BIGINT_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (input < minimum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxSize = /* @__PURE__ */ $constructor("$ZodCheckMaxSize", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size <= def.maximum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinSize = /* @__PURE__ */ $constructor("$ZodCheckMinSize", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size >= def.minimum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckSizeEquals = /* @__PURE__ */ $constructor("$ZodCheckSizeEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.size;
    bag.maximum = def.size;
    bag.size = def.size;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size === def.size)
      return;
    const tooBig = size > def.size;
    payload.issues.push({
      origin: getSizableOrigin(input),
      ...tooBig ? { code: "too_big", maximum: def.size } : { code: "too_small", minimum: def.size },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a3, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function handleCheckPropertyResult(result, payload, property) {
  if (result.issues.length) {
    payload.issues.push(...prefixIssues(property, result.issues));
  }
}
var $ZodCheckProperty = /* @__PURE__ */ $constructor("$ZodCheckProperty", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    const result = def.schema._zod.run({
      value: payload.value[def.property],
      issues: []
    }, {});
    if (result instanceof Promise) {
      return result.then((result2) => handleCheckPropertyResult(result2, payload, def.property));
    }
    handleCheckPropertyResult(result, payload, def.property);
    return;
  };
});
var $ZodCheckMimeType = /* @__PURE__ */ $constructor("$ZodCheckMimeType", (inst, def) => {
  $ZodCheck.init(inst, def);
  const mimeSet = new Set(def.mime);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.mime = def.mime;
  });
  inst._zod.check = (payload) => {
    if (mimeSet.has(payload.value.type))
      return;
    payload.issues.push({
      code: "invalid_value",
      values: def.mime,
      input: payload.value.type,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join("\n"));
  }
};

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url2 = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url2.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url2.protocol.endsWith(":") ? url2.protocol.slice(0, -1) : url2.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url2.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodMAC = /* @__PURE__ */ $constructor("$ZodMAC", (inst, def) => {
  def.pattern ?? (def.pattern = mac(def.delimiter));
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `mac`;
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error();
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error();
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error();
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error();
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base643 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base643.padEnd(Math.ceil(base643.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCustomStringFormat = /* @__PURE__ */ $constructor("$ZodCustomStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (def.fn(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: def.format,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodBigInt = /* @__PURE__ */ $constructor("$ZodBigInt", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = bigint;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = BigInt(payload.value);
      } catch (_) {
      }
    if (typeof payload.value === "bigint")
      return payload;
    payload.issues.push({
      expected: "bigint",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodBigIntFormat = /* @__PURE__ */ $constructor("$ZodBigIntFormat", (inst, def) => {
  $ZodCheckBigIntFormat.init(inst, def);
  $ZodBigInt.init(inst, def);
});
var $ZodSymbol = /* @__PURE__ */ $constructor("$ZodSymbol", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "symbol")
      return payload;
    payload.issues.push({
      expected: "symbol",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUndefined = /* @__PURE__ */ $constructor("$ZodUndefined", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _undefined;
  inst._zod.values = /* @__PURE__ */ new Set([void 0]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "undefined",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null;
  inst._zod.values = /* @__PURE__ */ new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodAny = /* @__PURE__ */ $constructor("$ZodAny", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodVoid = /* @__PURE__ */ $constructor("$ZodVoid", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "void",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodDate = /* @__PURE__ */ $constructor("$ZodDate", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce) {
      try {
        payload.value = new Date(payload.value);
      } catch (_err) {
      }
    }
    const input = payload.value;
    const isDate = input instanceof Date;
    const isValidDate = isDate && !Number.isNaN(input.getTime());
    if (isValidDate)
      return payload;
    payload.issues.push({
      expected: "date",
      code: "invalid_type",
      input,
      ...isDate ? { received: "Invalid Date" } : {},
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
function handleExclusiveUnionResults(results, final, inst, ctx) {
  const successes = results.filter((r) => r.issues.length === 0);
  if (successes.length === 1) {
    final.value = successes[0].value;
    return final;
  }
  if (successes.length === 0) {
    final.issues.push({
      code: "invalid_union",
      input: final.value,
      inst,
      errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
    });
  } else {
    final.issues.push({
      code: "invalid_union",
      input: final.value,
      inst,
      errors: [],
      inclusive: false
    });
  }
  return final;
}
var $ZodXor = /* @__PURE__ */ $constructor("$ZodXor", (inst, def) => {
  $ZodUnion.init(inst, def);
  def.inclusive = false;
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        results.push(result);
      }
    }
    if (!async)
      return handleExclusiveUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleExclusiveUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazy(inst._zod, "propValues", () => {
    const propValues = {};
    for (const option of def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
      for (const [k, v] of Object.entries(pv)) {
        if (!propValues[k])
          propValues[k] = /* @__PURE__ */ new Set();
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    return propValues;
  });
  const disc = cached(() => {
    const opts = def.options;
    const map2 = /* @__PURE__ */ new Map();
    for (const o of opts) {
      const values = o._zod.propValues?.[def.discriminator];
      if (!values || values.size === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
      for (const v of values) {
        if (map2.has(v)) {
          throw new Error(`Duplicate discriminator value "${String(v)}"`);
        }
        map2.set(v, o);
      }
    }
    return map2;
  });
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const opt = disc.value.get(input?.[def.discriminator]);
    if (opt) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f2]) => f2.l && f2.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodTuple = /* @__PURE__ */ $constructor("$ZodTuple", (inst, def) => {
  $ZodType.init(inst, def);
  const items = def.items;
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        input,
        inst,
        expected: "tuple",
        code: "invalid_type"
      });
      return payload;
    }
    payload.value = [];
    const proms = [];
    const optinStart = getTupleOptStart(items, "optin");
    const optoutStart = getTupleOptStart(items, "optout");
    if (!def.rest) {
      if (input.length < optinStart) {
        payload.issues.push({
          code: "too_small",
          minimum: optinStart,
          inclusive: true,
          input,
          inst,
          origin: "array"
        });
        return payload;
      }
      if (input.length > items.length) {
        payload.issues.push({
          code: "too_big",
          maximum: items.length,
          inclusive: true,
          input,
          inst,
          origin: "array"
        });
      }
    }
    const itemResults = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const r = items[i]._zod.run({ value: input[i], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((rr) => {
          itemResults[i] = rr;
        }));
      } else {
        itemResults[i] = r;
      }
    }
    if (def.rest) {
      let i = items.length - 1;
      const rest = input.slice(items.length);
      for (const el of rest) {
        i++;
        const result = def.rest._zod.run({ value: el, issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((r) => handleTupleResult(r, payload, i)));
        } else {
          handleTupleResult(result, payload, i);
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input, optoutStart));
    }
    return handleTupleResults(itemResults, payload, items, input, optoutStart);
  };
});
function getTupleOptStart(items, key) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]._zod[key] !== "optional")
      return i + 1;
  }
  return 0;
}
function handleTupleResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
function handleTupleResults(itemResults, final, items, input, optoutStart) {
  for (let i = 0; i < items.length; i++) {
    const r = itemResults[i];
    const isPresent = i < input.length;
    if (r.issues.length) {
      if (!isPresent && i >= optoutStart) {
        final.value.length = i;
        break;
      }
      final.issues.push(...prefixIssues(i, r.issues));
    }
    final.value[i] = r.value;
  }
  for (let i = final.value.length - 1; i >= input.length; i--) {
    if (items[i]._zod.optout === "optional" && final.value[i] === void 0) {
      final.value.length = i;
    } else {
      break;
    }
  }
  return final;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values) {
      payload.value = {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[keyResult.value] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodMap = /* @__PURE__ */ $constructor("$ZodMap", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!(input instanceof Map)) {
      payload.issues.push({
        expected: "map",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    payload.value = /* @__PURE__ */ new Map();
    for (const [key, value] of input) {
      const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
      const valueResult = def.valueType._zod.run({ value, issues: [] }, ctx);
      if (keyResult instanceof Promise || valueResult instanceof Promise) {
        proms.push(Promise.all([keyResult, valueResult]).then(([keyResult2, valueResult2]) => {
          handleMapResult(keyResult2, valueResult2, payload, key, input, inst, ctx);
        }));
      } else {
        handleMapResult(keyResult, valueResult, payload, key, input, inst, ctx);
      }
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleMapResult(keyResult, valueResult, final, key, input, inst, ctx) {
  if (keyResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, keyResult.issues));
    } else {
      final.issues.push({
        code: "invalid_key",
        origin: "map",
        input,
        inst,
        issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  if (valueResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, valueResult.issues));
    } else {
      final.issues.push({
        origin: "map",
        code: "invalid_element",
        input,
        inst,
        key,
        issues: valueResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  final.value.set(keyResult.value, valueResult.value);
}
var $ZodSet = /* @__PURE__ */ $constructor("$ZodSet", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!(input instanceof Set)) {
      payload.issues.push({
        input,
        inst,
        expected: "set",
        code: "invalid_type"
      });
      return payload;
    }
    const proms = [];
    payload.value = /* @__PURE__ */ new Set();
    for (const item of input) {
      const result = def.valueType._zod.run({ value: item, issues: [] }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleSetResult(result2, payload)));
      } else
        handleSetResult(result, payload);
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleSetResult(result, final) {
  if (result.issues.length) {
    final.issues.push(...result.issues);
  }
  final.value.add(result.value);
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  const values = new Set(def.values);
  inst._zod.values = values;
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodFile = /* @__PURE__ */ $constructor("$ZodFile", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input instanceof File)
      return payload;
    payload.issues.push({
      expected: "file",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        payload.fallback = true;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === void 0 && (result.issues.length || result.fallback)) {
    return { issues: [], value: void 0 };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === void 0) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodSuccess = /* @__PURE__ */ $constructor("$ZodSuccess", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError("ZodSuccess");
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.issues.length === 0;
        return payload;
      });
    }
    payload.value = result.issues.length === 0;
    return payload;
  };
});
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
var $ZodNaN = /* @__PURE__ */ $constructor("$ZodNaN", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "number" || !Number.isNaN(payload.value)) {
      payload.issues.push({
        input: payload.value,
        inst,
        expected: "nan",
        code: "invalid_type"
      });
      return payload;
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
var $ZodCodec = /* @__PURE__ */ $constructor("$ZodCodec", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    const direction = ctx.direction || "forward";
    if (direction === "forward") {
      const left = def.in._zod.run(payload, ctx);
      if (left instanceof Promise) {
        return left.then((left2) => handleCodecAResult(left2, def, ctx));
      }
      return handleCodecAResult(left, def, ctx);
    } else {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handleCodecAResult(right2, def, ctx));
      }
      return handleCodecAResult(right, def, ctx);
    }
  };
});
function handleCodecAResult(result, def, ctx) {
  if (result.issues.length) {
    result.aborted = true;
    return result;
  }
  const direction = ctx.direction || "forward";
  if (direction === "forward") {
    const transformed = def.transform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.out, ctx));
    }
    return handleCodecTxResult(result, transformed, def.out, ctx);
  } else {
    const transformed = def.reverseTransform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.in, ctx));
    }
    return handleCodecTxResult(result, transformed, def.in, ctx);
  }
}
function handleCodecTxResult(left, value, nextSchema, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return nextSchema._zod.run({ value, issues: left.issues }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
});
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodTemplateLiteral = /* @__PURE__ */ $constructor("$ZodTemplateLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const regexParts = [];
  for (const part of def.parts) {
    if (typeof part === "object" && part !== null) {
      if (!part._zod.pattern) {
        throw new Error(`Invalid template literal part, no pattern found: ${[...part._zod.traits].shift()}`);
      }
      const source = part._zod.pattern instanceof RegExp ? part._zod.pattern.source : part._zod.pattern;
      if (!source)
        throw new Error(`Invalid template literal part: ${part._zod.traits}`);
      const start = source.startsWith("^") ? 1 : 0;
      const end = source.endsWith("$") ? source.length - 1 : source.length;
      regexParts.push(source.slice(start, end));
    } else if (part === null || primitiveTypes.has(typeof part)) {
      regexParts.push(escapeRegex(`${part}`));
    } else {
      throw new Error(`Invalid template literal part: ${part}`);
    }
  }
  inst._zod.pattern = new RegExp(`^${regexParts.join("")}$`);
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "string") {
      payload.issues.push({
        input: payload.value,
        inst,
        expected: "string",
        code: "invalid_type"
      });
      return payload;
    }
    inst._zod.pattern.lastIndex = 0;
    if (!inst._zod.pattern.test(payload.value)) {
      payload.issues.push({
        input: payload.value,
        inst,
        code: "invalid_format",
        format: def.format ?? "template_literal",
        pattern: inst._zod.pattern.source
      });
      return payload;
    }
    return payload;
  };
});
var $ZodFunction = /* @__PURE__ */ $constructor("$ZodFunction", (inst, def) => {
  $ZodType.init(inst, def);
  inst._def = def;
  inst._zod.def = def;
  inst.implement = (func) => {
    if (typeof func !== "function") {
      throw new Error("implement() must be called with a function");
    }
    return function(...args) {
      const parsedArgs = inst._def.input ? parse(inst._def.input, args) : args;
      const result = Reflect.apply(func, this, parsedArgs);
      if (inst._def.output) {
        return parse(inst._def.output, result);
      }
      return result;
    };
  };
  inst.implementAsync = (func) => {
    if (typeof func !== "function") {
      throw new Error("implementAsync() must be called with a function");
    }
    return async function(...args) {
      const parsedArgs = inst._def.input ? await parseAsync(inst._def.input, args) : args;
      const result = await Reflect.apply(func, this, parsedArgs);
      if (inst._def.output) {
        return await parseAsync(inst._def.output, result);
      }
      return result;
    };
  };
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "function") {
      payload.issues.push({
        code: "invalid_type",
        expected: "function",
        input: payload.value,
        inst
      });
      return payload;
    }
    const hasPromiseOutput = inst._def.output && inst._def.output._zod.def.type === "promise";
    if (hasPromiseOutput) {
      payload.value = inst.implementAsync(payload.value);
    } else {
      payload.value = inst.implement(payload.value);
    }
    return payload;
  };
  inst.input = (...args) => {
    const F = inst.constructor;
    if (Array.isArray(args[0])) {
      return new F({
        type: "function",
        input: new $ZodTuple({
          type: "tuple",
          items: args[0],
          rest: args[1]
        }),
        output: inst._def.output
      });
    }
    return new F({
      type: "function",
      input: args[0],
      output: inst._def.output
    });
  };
  inst.output = (output) => {
    const F = inst.constructor;
    return new F({
      type: "function",
      input: inst._def.input,
      output
    });
  };
  return inst;
});
var $ZodPromise = /* @__PURE__ */ $constructor("$ZodPromise", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    return Promise.resolve(payload.value).then((inner) => def.innerType._zod.run({ value: inner, issues: [] }, ctx));
  };
});
var $ZodLazy = /* @__PURE__ */ $constructor("$ZodLazy", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "innerType", () => {
    const d = def;
    if (!d._cachedInner)
      d._cachedInner = def.getter();
    return d._cachedInner;
  });
  defineLazy(inst._zod, "pattern", () => inst._zod.innerType?._zod?.pattern);
  defineLazy(inst._zod, "propValues", () => inst._zod.innerType?._zod?.propValues);
  defineLazy(inst._zod, "optin", () => inst._zod.innerType?._zod?.optin ?? void 0);
  defineLazy(inst._zod, "optout", () => inst._zod.innerType?._zod?.optout ?? void 0);
  inst._zod.parse = (payload, ctx) => {
    const inner = inst._zod.innerType;
    return inner._zod.run(payload, ctx);
  };
});
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// node_modules/zod/v4/locales/index.js
var locales_exports = {};
__export(locales_exports, {
  ar: () => ar_default,
  az: () => az_default,
  be: () => be_default,
  bg: () => bg_default,
  ca: () => ca_default,
  cs: () => cs_default,
  da: () => da_default,
  de: () => de_default,
  el: () => el_default,
  en: () => en_default,
  eo: () => eo_default,
  es: () => es_default,
  fa: () => fa_default,
  fi: () => fi_default,
  fr: () => fr_default,
  frCA: () => fr_CA_default,
  he: () => he_default,
  hr: () => hr_default,
  hu: () => hu_default,
  hy: () => hy_default,
  id: () => id_default,
  is: () => is_default,
  it: () => it_default,
  ja: () => ja_default,
  ka: () => ka_default,
  kh: () => kh_default,
  km: () => km_default,
  ko: () => ko_default,
  lt: () => lt_default,
  mk: () => mk_default,
  ms: () => ms_default,
  nl: () => nl_default,
  no: () => no_default,
  ota: () => ota_default,
  pl: () => pl_default,
  ps: () => ps_default,
  pt: () => pt_default,
  ro: () => ro_default,
  ru: () => ru_default,
  sl: () => sl_default,
  sv: () => sv_default,
  ta: () => ta_default,
  th: () => th_default,
  tr: () => tr_default,
  ua: () => ua_default,
  uk: () => uk_default,
  ur: () => ur_default,
  uz: () => uz_default,
  vi: () => vi_default,
  yo: () => yo_default,
  zhCN: () => zh_CN_default,
  zhTW: () => zh_TW_default
});

// node_modules/zod/v4/locales/ar.js
var error = () => {
  const Sizable = {
    string: { unit: "حرف", verb: "أن يحوي" },
    file: { unit: "بايت", verb: "أن يحوي" },
    array: { unit: "عنصر", verb: "أن يحوي" },
    set: { unit: "عنصر", verb: "أن يحوي" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "مدخل",
    email: "بريد إلكتروني",
    url: "رابط",
    emoji: "إيموجي",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "تاريخ ووقت بمعيار ISO",
    date: "تاريخ بمعيار ISO",
    time: "وقت بمعيار ISO",
    duration: "مدة بمعيار ISO",
    ipv4: "عنوان IPv4",
    ipv6: "عنوان IPv6",
    cidrv4: "مدى عناوين بصيغة IPv4",
    cidrv6: "مدى عناوين بصيغة IPv6",
    base64: "نَص بترميز base64-encoded",
    base64url: "نَص بترميز base64url-encoded",
    json_string: "نَص على هيئة JSON",
    e164: "رقم هاتف بمعيار E.164",
    jwt: "JWT",
    template_literal: "مدخل"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `مدخلات غير مقبولة: يفترض إدخال instanceof ${issue2.expected}، ولكن تم إدخال ${received}`;
        }
        return `مدخلات غير مقبولة: يفترض إدخال ${expected}، ولكن تم إدخال ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `مدخلات غير مقبولة: يفترض إدخال ${stringifyPrimitive(issue2.values[0])}`;
        return `اختيار غير مقبول: يتوقع انتقاء أحد هذه الخيارات: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return ` أكبر من اللازم: يفترض أن تكون ${issue2.origin ?? "القيمة"} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "عنصر"}`;
        return `أكبر من اللازم: يفترض أن تكون ${issue2.origin ?? "القيمة"} ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `أصغر من اللازم: يفترض لـ ${issue2.origin} أن يكون ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `أصغر من اللازم: يفترض لـ ${issue2.origin} أن يكون ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `نَص غير مقبول: يجب أن يبدأ بـ "${issue2.prefix}"`;
        if (_issue.format === "ends_with")
          return `نَص غير مقبول: يجب أن ينتهي بـ "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `نَص غير مقبول: يجب أن يتضمَّن "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `نَص غير مقبول: يجب أن يطابق النمط ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} غير مقبول`;
      }
      case "not_multiple_of":
        return `رقم غير مقبول: يجب أن يكون من مضاعفات ${issue2.divisor}`;
      case "unrecognized_keys":
        return `معرف${issue2.keys.length > 1 ? "ات" : ""} غريب${issue2.keys.length > 1 ? "ة" : ""}: ${joinValues(issue2.keys, "، ")}`;
      case "invalid_key":
        return `معرف غير مقبول في ${issue2.origin}`;
      case "invalid_union":
        return "مدخل غير مقبول";
      case "invalid_element":
        return `مدخل غير مقبول في ${issue2.origin}`;
      default:
        return "مدخل غير مقبول";
    }
  };
};
function ar_default() {
  return {
    localeError: error()
  };
}

// node_modules/zod/v4/locales/az.js
var error2 = () => {
  const Sizable = {
    string: { unit: "simvol", verb: "olmalıdır" },
    file: { unit: "bayt", verb: "olmalıdır" },
    array: { unit: "element", verb: "olmalıdır" },
    set: { unit: "element", verb: "olmalıdır" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Yanlış dəyər: gözlənilən instanceof ${issue2.expected}, daxil olan ${received}`;
        }
        return `Yanlış dəyər: gözlənilən ${expected}, daxil olan ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Yanlış dəyər: gözlənilən ${stringifyPrimitive(issue2.values[0])}`;
        return `Yanlış seçim: aşağıdakılardan biri olmalıdır: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Çox böyük: gözlənilən ${issue2.origin ?? "dəyər"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "element"}`;
        return `Çox böyük: gözlənilən ${issue2.origin ?? "dəyər"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Çox kiçik: gözlənilən ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        return `Çox kiçik: gözlənilən ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Yanlış mətn: "${_issue.prefix}" ilə başlamalıdır`;
        if (_issue.format === "ends_with")
          return `Yanlış mətn: "${_issue.suffix}" ilə bitməlidir`;
        if (_issue.format === "includes")
          return `Yanlış mətn: "${_issue.includes}" daxil olmalıdır`;
        if (_issue.format === "regex")
          return `Yanlış mətn: ${_issue.pattern} şablonuna uyğun olmalıdır`;
        return `Yanlış ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Yanlış ədəd: ${issue2.divisor} ilə bölünə bilən olmalıdır`;
      case "unrecognized_keys":
        return `Tanınmayan açar${issue2.keys.length > 1 ? "lar" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} daxilində yanlış açar`;
      case "invalid_union":
        return "Yanlış dəyər";
      case "invalid_element":
        return `${issue2.origin} daxilində yanlış dəyər`;
      default:
        return `Yanlış dəyər`;
    }
  };
};
function az_default() {
  return {
    localeError: error2()
  };
}

// node_modules/zod/v4/locales/be.js
function getBelarusianPlural(count, one, few, many) {
  const absCount = Math.abs(count);
  const lastDigit = absCount % 10;
  const lastTwoDigits = absCount % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return many;
  }
  if (lastDigit === 1) {
    return one;
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return few;
  }
  return many;
}
var error3 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "сімвал",
        few: "сімвалы",
        many: "сімвалаў"
      },
      verb: "мець"
    },
    array: {
      unit: {
        one: "элемент",
        few: "элементы",
        many: "элементаў"
      },
      verb: "мець"
    },
    set: {
      unit: {
        one: "элемент",
        few: "элементы",
        many: "элементаў"
      },
      verb: "мець"
    },
    file: {
      unit: {
        one: "байт",
        few: "байты",
        many: "байтаў"
      },
      verb: "мець"
    }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "увод",
    email: "email адрас",
    url: "URL",
    emoji: "эмодзі",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO дата і час",
    date: "ISO дата",
    time: "ISO час",
    duration: "ISO працягласць",
    ipv4: "IPv4 адрас",
    ipv6: "IPv6 адрас",
    cidrv4: "IPv4 дыяпазон",
    cidrv6: "IPv6 дыяпазон",
    base64: "радок у фармаце base64",
    base64url: "радок у фармаце base64url",
    json_string: "JSON радок",
    e164: "нумар E.164",
    jwt: "JWT",
    template_literal: "увод"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "лік",
    array: "масіў"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Няправільны ўвод: чакаўся instanceof ${issue2.expected}, атрымана ${received}`;
        }
        return `Няправільны ўвод: чакаўся ${expected}, атрымана ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Няправільны ўвод: чакалася ${stringifyPrimitive(issue2.values[0])}`;
        return `Няправільны варыянт: чакаўся адзін з ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const maxValue = Number(issue2.maximum);
          const unit = getBelarusianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `Занадта вялікі: чакалася, што ${issue2.origin ?? "значэнне"} павінна ${sizing.verb} ${adj}${issue2.maximum.toString()} ${unit}`;
        }
        return `Занадта вялікі: чакалася, што ${issue2.origin ?? "значэнне"} павінна быць ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const minValue = Number(issue2.minimum);
          const unit = getBelarusianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `Занадта малы: чакалася, што ${issue2.origin} павінна ${sizing.verb} ${adj}${issue2.minimum.toString()} ${unit}`;
        }
        return `Занадта малы: чакалася, што ${issue2.origin} павінна быць ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Няправільны радок: павінен пачынацца з "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Няправільны радок: павінен заканчвацца на "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Няправільны радок: павінен змяшчаць "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Няправільны радок: павінен адпавядаць шаблону ${_issue.pattern}`;
        return `Няправільны ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Няправільны лік: павінен быць кратным ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Нераспазнаны ${issue2.keys.length > 1 ? "ключы" : "ключ"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Няправільны ключ у ${issue2.origin}`;
      case "invalid_union":
        return "Няправільны ўвод";
      case "invalid_element":
        return `Няправільнае значэнне ў ${issue2.origin}`;
      default:
        return `Няправільны ўвод`;
    }
  };
};
function be_default() {
  return {
    localeError: error3()
  };
}

// node_modules/zod/v4/locales/bg.js
var error4 = () => {
  const Sizable = {
    string: { unit: "символа", verb: "да съдържа" },
    file: { unit: "байта", verb: "да съдържа" },
    array: { unit: "елемента", verb: "да съдържа" },
    set: { unit: "елемента", verb: "да съдържа" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "вход",
    email: "имейл адрес",
    url: "URL",
    emoji: "емоджи",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO време",
    date: "ISO дата",
    time: "ISO време",
    duration: "ISO продължителност",
    ipv4: "IPv4 адрес",
    ipv6: "IPv6 адрес",
    cidrv4: "IPv4 диапазон",
    cidrv6: "IPv6 диапазон",
    base64: "base64-кодиран низ",
    base64url: "base64url-кодиран низ",
    json_string: "JSON низ",
    e164: "E.164 номер",
    jwt: "JWT",
    template_literal: "вход"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "число",
    array: "масив"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Невалиден вход: очакван instanceof ${issue2.expected}, получен ${received}`;
        }
        return `Невалиден вход: очакван ${expected}, получен ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Невалиден вход: очакван ${stringifyPrimitive(issue2.values[0])}`;
        return `Невалидна опция: очаквано едно от ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Твърде голямо: очаква се ${issue2.origin ?? "стойност"} да съдържа ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "елемента"}`;
        return `Твърде голямо: очаква се ${issue2.origin ?? "стойност"} да бъде ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Твърде малко: очаква се ${issue2.origin} да съдържа ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Твърде малко: очаква се ${issue2.origin} да бъде ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Невалиден низ: трябва да започва с "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Невалиден низ: трябва да завършва с "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Невалиден низ: трябва да включва "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Невалиден низ: трябва да съвпада с ${_issue.pattern}`;
        let invalid_adj = "Невалиден";
        if (_issue.format === "emoji")
          invalid_adj = "Невалидно";
        if (_issue.format === "datetime")
          invalid_adj = "Невалидно";
        if (_issue.format === "date")
          invalid_adj = "Невалидна";
        if (_issue.format === "time")
          invalid_adj = "Невалидно";
        if (_issue.format === "duration")
          invalid_adj = "Невалидна";
        return `${invalid_adj} ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Невалидно число: трябва да бъде кратно на ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Неразпознат${issue2.keys.length > 1 ? "и" : ""} ключ${issue2.keys.length > 1 ? "ове" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Невалиден ключ в ${issue2.origin}`;
      case "invalid_union":
        return "Невалиден вход";
      case "invalid_element":
        return `Невалидна стойност в ${issue2.origin}`;
      default:
        return `Невалиден вход`;
    }
  };
};
function bg_default() {
  return {
    localeError: error4()
  };
}

// node_modules/zod/v4/locales/ca.js
var error5 = () => {
  const Sizable = {
    string: { unit: "caràcters", verb: "contenir" },
    file: { unit: "bytes", verb: "contenir" },
    array: { unit: "elements", verb: "contenir" },
    set: { unit: "elements", verb: "contenir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "entrada",
    email: "adreça electrònica",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data i hora ISO",
    date: "data ISO",
    time: "hora ISO",
    duration: "durada ISO",
    ipv4: "adreça IPv4",
    ipv6: "adreça IPv6",
    cidrv4: "rang IPv4",
    cidrv6: "rang IPv6",
    base64: "cadena codificada en base64",
    base64url: "cadena codificada en base64url",
    json_string: "cadena JSON",
    e164: "número E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Tipus invàlid: s'esperava instanceof ${issue2.expected}, s'ha rebut ${received}`;
        }
        return `Tipus invàlid: s'esperava ${expected}, s'ha rebut ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Valor invàlid: s'esperava ${stringifyPrimitive(issue2.values[0])}`;
        return `Opció invàlida: s'esperava una de ${joinValues(issue2.values, " o ")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "com a màxim" : "menys de";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Massa gran: s'esperava que ${issue2.origin ?? "el valor"} contingués ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Massa gran: s'esperava que ${issue2.origin ?? "el valor"} fos ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "com a mínim" : "més de";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Massa petit: s'esperava que ${issue2.origin} contingués ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Massa petit: s'esperava que ${issue2.origin} fos ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Format invàlid: ha de començar amb "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Format invàlid: ha d'acabar amb "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Format invàlid: ha d'incloure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Format invàlid: ha de coincidir amb el patró ${_issue.pattern}`;
        return `Format invàlid per a ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Número invàlid: ha de ser múltiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Clau${issue2.keys.length > 1 ? "s" : ""} no reconeguda${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Clau invàlida a ${issue2.origin}`;
      case "invalid_union":
        return "Entrada invàlida";
      // Could also be "Tipus d'unió invàlid" but "Entrada invàlida" is more general
      case "invalid_element":
        return `Element invàlid a ${issue2.origin}`;
      default:
        return `Entrada invàlida`;
    }
  };
};
function ca_default() {
  return {
    localeError: error5()
  };
}

// node_modules/zod/v4/locales/cs.js
var error6 = () => {
  const Sizable = {
    string: { unit: "znaků", verb: "mít" },
    file: { unit: "bajtů", verb: "mít" },
    array: { unit: "prvků", verb: "mít" },
    set: { unit: "prvků", verb: "mít" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "regulární výraz",
    email: "e-mailová adresa",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "datum a čas ve formátu ISO",
    date: "datum ve formátu ISO",
    time: "čas ve formátu ISO",
    duration: "doba trvání ISO",
    ipv4: "IPv4 adresa",
    ipv6: "IPv6 adresa",
    cidrv4: "rozsah IPv4",
    cidrv6: "rozsah IPv6",
    base64: "řetězec zakódovaný ve formátu base64",
    base64url: "řetězec zakódovaný ve formátu base64url",
    json_string: "řetězec ve formátu JSON",
    e164: "číslo E.164",
    jwt: "JWT",
    template_literal: "vstup"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "číslo",
    string: "řetězec",
    function: "funkce",
    array: "pole"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Neplatný vstup: očekáváno instanceof ${issue2.expected}, obdrženo ${received}`;
        }
        return `Neplatný vstup: očekáváno ${expected}, obdrženo ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Neplatný vstup: očekáváno ${stringifyPrimitive(issue2.values[0])}`;
        return `Neplatná možnost: očekávána jedna z hodnot ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Hodnota je příliš velká: ${issue2.origin ?? "hodnota"} musí mít ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "prvků"}`;
        }
        return `Hodnota je příliš velká: ${issue2.origin ?? "hodnota"} musí být ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Hodnota je příliš malá: ${issue2.origin ?? "hodnota"} musí mít ${adj}${issue2.minimum.toString()} ${sizing.unit ?? "prvků"}`;
        }
        return `Hodnota je příliš malá: ${issue2.origin ?? "hodnota"} musí být ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Neplatný řetězec: musí začínat na "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Neplatný řetězec: musí končit na "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Neplatný řetězec: musí obsahovat "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Neplatný řetězec: musí odpovídat vzoru ${_issue.pattern}`;
        return `Neplatný formát ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Neplatné číslo: musí být násobkem ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Neznámé klíče: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Neplatný klíč v ${issue2.origin}`;
      case "invalid_union":
        return "Neplatný vstup";
      case "invalid_element":
        return `Neplatná hodnota v ${issue2.origin}`;
      default:
        return `Neplatný vstup`;
    }
  };
};
function cs_default() {
  return {
    localeError: error6()
  };
}

// node_modules/zod/v4/locales/da.js
var error7 = () => {
  const Sizable = {
    string: { unit: "tegn", verb: "havde" },
    file: { unit: "bytes", verb: "havde" },
    array: { unit: "elementer", verb: "indeholdt" },
    set: { unit: "elementer", verb: "indeholdt" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "e-mailadresse",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dato- og klokkeslæt",
    date: "ISO-dato",
    time: "ISO-klokkeslæt",
    duration: "ISO-varighed",
    ipv4: "IPv4-område",
    ipv6: "IPv6-område",
    cidrv4: "IPv4-spektrum",
    cidrv6: "IPv6-spektrum",
    base64: "base64-kodet streng",
    base64url: "base64url-kodet streng",
    json_string: "JSON-streng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    string: "streng",
    number: "tal",
    boolean: "boolean",
    array: "liste",
    object: "objekt",
    set: "sæt",
    file: "fil"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ugyldigt input: forventede instanceof ${issue2.expected}, fik ${received}`;
        }
        return `Ugyldigt input: forventede ${expected}, fik ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ugyldig værdi: forventede ${stringifyPrimitive(issue2.values[0])}`;
        return `Ugyldigt valg: forventede en af følgende ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing)
          return `For stor: forventede ${origin ?? "value"} ${sizing.verb} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "elementer"}`;
        return `For stor: forventede ${origin ?? "value"} havde ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing) {
          return `For lille: forventede ${origin} ${sizing.verb} ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `For lille: forventede ${origin} havde ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ugyldig streng: skal starte med "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Ugyldig streng: skal ende med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ugyldig streng: skal indeholde "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ugyldig streng: skal matche mønsteret ${_issue.pattern}`;
        return `Ugyldig ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ugyldigt tal: skal være deleligt med ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Ukendte nøgler" : "Ukendt nøgle"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ugyldig nøgle i ${issue2.origin}`;
      case "invalid_union":
        return "Ugyldigt input: matcher ingen af de tilladte typer";
      case "invalid_element":
        return `Ugyldig værdi i ${issue2.origin}`;
      default:
        return `Ugyldigt input`;
    }
  };
};
function da_default() {
  return {
    localeError: error7()
  };
}

// node_modules/zod/v4/locales/de.js
var error8 = () => {
  const Sizable = {
    string: { unit: "Zeichen", verb: "zu haben" },
    file: { unit: "Bytes", verb: "zu haben" },
    array: { unit: "Elemente", verb: "zu haben" },
    set: { unit: "Elemente", verb: "zu haben" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "Eingabe",
    email: "E-Mail-Adresse",
    url: "URL",
    emoji: "Emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-Datum und -Uhrzeit",
    date: "ISO-Datum",
    time: "ISO-Uhrzeit",
    duration: "ISO-Dauer",
    ipv4: "IPv4-Adresse",
    ipv6: "IPv6-Adresse",
    cidrv4: "IPv4-Bereich",
    cidrv6: "IPv6-Bereich",
    base64: "Base64-codierter String",
    base64url: "Base64-URL-codierter String",
    json_string: "JSON-String",
    e164: "E.164-Nummer",
    jwt: "JWT",
    template_literal: "Eingabe"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "Zahl",
    array: "Array"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ungültige Eingabe: erwartet instanceof ${issue2.expected}, erhalten ${received}`;
        }
        return `Ungültige Eingabe: erwartet ${expected}, erhalten ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ungültige Eingabe: erwartet ${stringifyPrimitive(issue2.values[0])}`;
        return `Ungültige Option: erwartet eine von ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Zu groß: erwartet, dass ${issue2.origin ?? "Wert"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "Elemente"} hat`;
        return `Zu groß: erwartet, dass ${issue2.origin ?? "Wert"} ${adj}${issue2.maximum.toString()} ist`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Zu klein: erwartet, dass ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} hat`;
        }
        return `Zu klein: erwartet, dass ${issue2.origin} ${adj}${issue2.minimum.toString()} ist`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ungültiger String: muss mit "${_issue.prefix}" beginnen`;
        if (_issue.format === "ends_with")
          return `Ungültiger String: muss mit "${_issue.suffix}" enden`;
        if (_issue.format === "includes")
          return `Ungültiger String: muss "${_issue.includes}" enthalten`;
        if (_issue.format === "regex")
          return `Ungültiger String: muss dem Muster ${_issue.pattern} entsprechen`;
        return `Ungültig: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ungültige Zahl: muss ein Vielfaches von ${issue2.divisor} sein`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Unbekannte Schlüssel" : "Unbekannter Schlüssel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ungültiger Schlüssel in ${issue2.origin}`;
      case "invalid_union":
        return "Ungültige Eingabe";
      case "invalid_element":
        return `Ungültiger Wert in ${issue2.origin}`;
      default:
        return `Ungültige Eingabe`;
    }
  };
};
function de_default() {
  return {
    localeError: error8()
  };
}

// node_modules/zod/v4/locales/el.js
var error9 = () => {
  const Sizable = {
    string: { unit: "χαρακτήρες", verb: "να έχει" },
    file: { unit: "bytes", verb: "να έχει" },
    array: { unit: "στοιχεία", verb: "να έχει" },
    set: { unit: "στοιχεία", verb: "να έχει" },
    map: { unit: "καταχωρήσεις", verb: "να έχει" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "είσοδος",
    email: "διεύθυνση email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO ημερομηνία και ώρα",
    date: "ISO ημερομηνία",
    time: "ISO ώρα",
    duration: "ISO διάρκεια",
    ipv4: "διεύθυνση IPv4",
    ipv6: "διεύθυνση IPv6",
    mac: "διεύθυνση MAC",
    cidrv4: "εύρος IPv4",
    cidrv6: "εύρος IPv6",
    base64: "συμβολοσειρά κωδικοποιημένη σε base64",
    base64url: "συμβολοσειρά κωδικοποιημένη σε base64url",
    json_string: "συμβολοσειρά JSON",
    e164: "αριθμός E.164",
    jwt: "JWT",
    template_literal: "είσοδος"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (typeof issue2.expected === "string" && /^[A-Z]/.test(issue2.expected)) {
          return `Μη έγκυρη είσοδος: αναμενόταν instanceof ${issue2.expected}, λήφθηκε ${received}`;
        }
        return `Μη έγκυρη είσοδος: αναμενόταν ${expected}, λήφθηκε ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Μη έγκυρη είσοδος: αναμενόταν ${stringifyPrimitive(issue2.values[0])}`;
        return `Μη έγκυρη επιλογή: αναμενόταν ένα από ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Πολύ μεγάλο: αναμενόταν ${issue2.origin ?? "τιμή"} να έχει ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "στοιχεία"}`;
        return `Πολύ μεγάλο: αναμενόταν ${issue2.origin ?? "τιμή"} να είναι ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Πολύ μικρό: αναμενόταν ${issue2.origin} να έχει ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Πολύ μικρό: αναμενόταν ${issue2.origin} να είναι ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Μη έγκυρη συμβολοσειρά: πρέπει να ξεκινά με "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Μη έγκυρη συμβολοσειρά: πρέπει να τελειώνει με "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Μη έγκυρη συμβολοσειρά: πρέπει να περιέχει "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Μη έγκυρη συμβολοσειρά: πρέπει να ταιριάζει με το μοτίβο ${_issue.pattern}`;
        return `Μη έγκυρο: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Μη έγκυρος αριθμός: πρέπει να είναι πολλαπλάσιο του ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Άγνωστ${issue2.keys.length > 1 ? "α" : "ο"} κλειδ${issue2.keys.length > 1 ? "ιά" : "ί"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Μη έγκυρο κλειδί στο ${issue2.origin}`;
      case "invalid_union":
        return "Μη έγκυρη είσοδος";
      case "invalid_element":
        return `Μη έγκυρη τιμή στο ${issue2.origin}`;
      default:
        return `Μη έγκυρη είσοδος`;
    }
  };
};
function el_default() {
  return {
    localeError: error9()
  };
}

// node_modules/zod/v4/locales/en.js
var error10 = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error10()
  };
}

// node_modules/zod/v4/locales/eo.js
var error11 = () => {
  const Sizable = {
    string: { unit: "karaktrojn", verb: "havi" },
    file: { unit: "bajtojn", verb: "havi" },
    array: { unit: "elementojn", verb: "havi" },
    set: { unit: "elementojn", verb: "havi" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "enigo",
    email: "retadreso",
    url: "URL",
    emoji: "emoĝio",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-datotempo",
    date: "ISO-dato",
    time: "ISO-tempo",
    duration: "ISO-daŭro",
    ipv4: "IPv4-adreso",
    ipv6: "IPv6-adreso",
    cidrv4: "IPv4-rango",
    cidrv6: "IPv6-rango",
    base64: "64-ume kodita karaktraro",
    base64url: "URL-64-ume kodita karaktraro",
    json_string: "JSON-karaktraro",
    e164: "E.164-nombro",
    jwt: "JWT",
    template_literal: "enigo"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "nombro",
    array: "tabelo",
    null: "senvalora"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Nevalida enigo: atendiĝis instanceof ${issue2.expected}, riceviĝis ${received}`;
        }
        return `Nevalida enigo: atendiĝis ${expected}, riceviĝis ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Nevalida enigo: atendiĝis ${stringifyPrimitive(issue2.values[0])}`;
        return `Nevalida opcio: atendiĝis unu el ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Tro granda: atendiĝis ke ${issue2.origin ?? "valoro"} havu ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementojn"}`;
        return `Tro granda: atendiĝis ke ${issue2.origin ?? "valoro"} havu ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Tro malgranda: atendiĝis ke ${issue2.origin} havu ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Tro malgranda: atendiĝis ke ${issue2.origin} estu ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Nevalida karaktraro: devas komenciĝi per "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Nevalida karaktraro: devas finiĝi per "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Nevalida karaktraro: devas inkluzivi "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Nevalida karaktraro: devas kongrui kun la modelo ${_issue.pattern}`;
        return `Nevalida ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Nevalida nombro: devas esti oblo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Nekonata${issue2.keys.length > 1 ? "j" : ""} ŝlosilo${issue2.keys.length > 1 ? "j" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Nevalida ŝlosilo en ${issue2.origin}`;
      case "invalid_union":
        return "Nevalida enigo";
      case "invalid_element":
        return `Nevalida valoro en ${issue2.origin}`;
      default:
        return `Nevalida enigo`;
    }
  };
};
function eo_default() {
  return {
    localeError: error11()
  };
}

// node_modules/zod/v4/locales/es.js
var error12 = () => {
  const Sizable = {
    string: { unit: "caracteres", verb: "tener" },
    file: { unit: "bytes", verb: "tener" },
    array: { unit: "elementos", verb: "tener" },
    set: { unit: "elementos", verb: "tener" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "entrada",
    email: "dirección de correo electrónico",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "fecha y hora ISO",
    date: "fecha ISO",
    time: "hora ISO",
    duration: "duración ISO",
    ipv4: "dirección IPv4",
    ipv6: "dirección IPv6",
    cidrv4: "rango IPv4",
    cidrv6: "rango IPv6",
    base64: "cadena codificada en base64",
    base64url: "URL codificada en base64",
    json_string: "cadena JSON",
    e164: "número E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  const TypeDictionary = {
    nan: "NaN",
    string: "texto",
    number: "número",
    boolean: "booleano",
    array: "arreglo",
    object: "objeto",
    set: "conjunto",
    file: "archivo",
    date: "fecha",
    bigint: "número grande",
    symbol: "símbolo",
    undefined: "indefinido",
    null: "nulo",
    function: "función",
    map: "mapa",
    record: "registro",
    tuple: "tupla",
    enum: "enumeración",
    union: "unión",
    literal: "literal",
    promise: "promesa",
    void: "vacío",
    never: "nunca",
    unknown: "desconocido",
    any: "cualquiera"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Entrada inválida: se esperaba instanceof ${issue2.expected}, recibido ${received}`;
        }
        return `Entrada inválida: se esperaba ${expected}, recibido ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrada inválida: se esperaba ${stringifyPrimitive(issue2.values[0])}`;
        return `Opción inválida: se esperaba una de ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing)
          return `Demasiado grande: se esperaba que ${origin ?? "valor"} tuviera ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementos"}`;
        return `Demasiado grande: se esperaba que ${origin ?? "valor"} fuera ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing) {
          return `Demasiado pequeño: se esperaba que ${origin} tuviera ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Demasiado pequeño: se esperaba que ${origin} fuera ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Cadena inválida: debe comenzar con "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Cadena inválida: debe terminar en "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Cadena inválida: debe incluir "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Cadena inválida: debe coincidir con el patrón ${_issue.pattern}`;
        return `Inválido ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Número inválido: debe ser múltiplo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Llave${issue2.keys.length > 1 ? "s" : ""} desconocida${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Llave inválida en ${TypeDictionary[issue2.origin] ?? issue2.origin}`;
      case "invalid_union":
        return "Entrada inválida";
      case "invalid_element":
        return `Valor inválido en ${TypeDictionary[issue2.origin] ?? issue2.origin}`;
      default:
        return `Entrada inválida`;
    }
  };
};
function es_default() {
  return {
    localeError: error12()
  };
}

// node_modules/zod/v4/locales/fa.js
var error13 = () => {
  const Sizable = {
    string: { unit: "کاراکتر", verb: "داشته باشد" },
    file: { unit: "بایت", verb: "داشته باشد" },
    array: { unit: "آیتم", verb: "داشته باشد" },
    set: { unit: "آیتم", verb: "داشته باشد" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "ورودی",
    email: "آدرس ایمیل",
    url: "URL",
    emoji: "ایموجی",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "تاریخ و زمان ایزو",
    date: "تاریخ ایزو",
    time: "زمان ایزو",
    duration: "مدت زمان ایزو",
    ipv4: "IPv4 آدرس",
    ipv6: "IPv6 آدرس",
    cidrv4: "IPv4 دامنه",
    cidrv6: "IPv6 دامنه",
    base64: "base64-encoded رشته",
    base64url: "base64url-encoded رشته",
    json_string: "JSON رشته",
    e164: "E.164 عدد",
    jwt: "JWT",
    template_literal: "ورودی"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "عدد",
    array: "آرایه"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `ورودی نامعتبر: می‌بایست instanceof ${issue2.expected} می‌بود، ${received} دریافت شد`;
        }
        return `ورودی نامعتبر: می‌بایست ${expected} می‌بود، ${received} دریافت شد`;
      }
      case "invalid_value":
        if (issue2.values.length === 1) {
          return `ورودی نامعتبر: می‌بایست ${stringifyPrimitive(issue2.values[0])} می‌بود`;
        }
        return `گزینه نامعتبر: می‌بایست یکی از ${joinValues(issue2.values, "|")} می‌بود`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `خیلی بزرگ: ${issue2.origin ?? "مقدار"} باید ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "عنصر"} باشد`;
        }
        return `خیلی بزرگ: ${issue2.origin ?? "مقدار"} باید ${adj}${issue2.maximum.toString()} باشد`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `خیلی کوچک: ${issue2.origin} باید ${adj}${issue2.minimum.toString()} ${sizing.unit} باشد`;
        }
        return `خیلی کوچک: ${issue2.origin} باید ${adj}${issue2.minimum.toString()} باشد`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `رشته نامعتبر: باید با "${_issue.prefix}" شروع شود`;
        }
        if (_issue.format === "ends_with") {
          return `رشته نامعتبر: باید با "${_issue.suffix}" تمام شود`;
        }
        if (_issue.format === "includes") {
          return `رشته نامعتبر: باید شامل "${_issue.includes}" باشد`;
        }
        if (_issue.format === "regex") {
          return `رشته نامعتبر: باید با الگوی ${_issue.pattern} مطابقت داشته باشد`;
        }
        return `${FormatDictionary[_issue.format] ?? issue2.format} نامعتبر`;
      }
      case "not_multiple_of":
        return `عدد نامعتبر: باید مضرب ${issue2.divisor} باشد`;
      case "unrecognized_keys":
        return `کلید${issue2.keys.length > 1 ? "های" : ""} ناشناس: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `کلید ناشناس در ${issue2.origin}`;
      case "invalid_union":
        return `ورودی نامعتبر`;
      case "invalid_element":
        return `مقدار نامعتبر در ${issue2.origin}`;
      default:
        return `ورودی نامعتبر`;
    }
  };
};
function fa_default() {
  return {
    localeError: error13()
  };
}

// node_modules/zod/v4/locales/fi.js
var error14 = () => {
  const Sizable = {
    string: { unit: "merkkiä", subject: "merkkijonon" },
    file: { unit: "tavua", subject: "tiedoston" },
    array: { unit: "alkiota", subject: "listan" },
    set: { unit: "alkiota", subject: "joukon" },
    number: { unit: "", subject: "luvun" },
    bigint: { unit: "", subject: "suuren kokonaisluvun" },
    int: { unit: "", subject: "kokonaisluvun" },
    date: { unit: "", subject: "päivämäärän" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "säännöllinen lauseke",
    email: "sähköpostiosoite",
    url: "URL-osoite",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-aikaleima",
    date: "ISO-päivämäärä",
    time: "ISO-aika",
    duration: "ISO-kesto",
    ipv4: "IPv4-osoite",
    ipv6: "IPv6-osoite",
    cidrv4: "IPv4-alue",
    cidrv6: "IPv6-alue",
    base64: "base64-koodattu merkkijono",
    base64url: "base64url-koodattu merkkijono",
    json_string: "JSON-merkkijono",
    e164: "E.164-luku",
    jwt: "JWT",
    template_literal: "templaattimerkkijono"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Virheellinen tyyppi: odotettiin instanceof ${issue2.expected}, oli ${received}`;
        }
        return `Virheellinen tyyppi: odotettiin ${expected}, oli ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Virheellinen syöte: täytyy olla ${stringifyPrimitive(issue2.values[0])}`;
        return `Virheellinen valinta: täytyy olla yksi seuraavista: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Liian suuri: ${sizing.subject} täytyy olla ${adj}${issue2.maximum.toString()} ${sizing.unit}`.trim();
        }
        return `Liian suuri: arvon täytyy olla ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Liian pieni: ${sizing.subject} täytyy olla ${adj}${issue2.minimum.toString()} ${sizing.unit}`.trim();
        }
        return `Liian pieni: arvon täytyy olla ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Virheellinen syöte: täytyy alkaa "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Virheellinen syöte: täytyy loppua "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Virheellinen syöte: täytyy sisältää "${_issue.includes}"`;
        if (_issue.format === "regex") {
          return `Virheellinen syöte: täytyy vastata säännöllistä lauseketta ${_issue.pattern}`;
        }
        return `Virheellinen ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Virheellinen luku: täytyy olla luvun ${issue2.divisor} monikerta`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Tuntemattomat avaimet" : "Tuntematon avain"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return "Virheellinen avain tietueessa";
      case "invalid_union":
        return "Virheellinen unioni";
      case "invalid_element":
        return "Virheellinen arvo joukossa";
      default:
        return `Virheellinen syöte`;
    }
  };
};
function fi_default() {
  return {
    localeError: error14()
  };
}

// node_modules/zod/v4/locales/fr.js
var error15 = () => {
  const Sizable = {
    string: { unit: "caractères", verb: "avoir" },
    file: { unit: "octets", verb: "avoir" },
    array: { unit: "éléments", verb: "avoir" },
    set: { unit: "éléments", verb: "avoir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "entrée",
    email: "adresse e-mail",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "date et heure ISO",
    date: "date ISO",
    time: "heure ISO",
    duration: "durée ISO",
    ipv4: "adresse IPv4",
    ipv6: "adresse IPv6",
    cidrv4: "plage IPv4",
    cidrv6: "plage IPv6",
    base64: "chaîne encodée en base64",
    base64url: "chaîne encodée en base64url",
    json_string: "chaîne JSON",
    e164: "numéro E.164",
    jwt: "JWT",
    template_literal: "entrée"
  };
  const TypeDictionary = {
    string: "chaîne",
    number: "nombre",
    int: "entier",
    boolean: "booléen",
    bigint: "grand entier",
    symbol: "symbole",
    undefined: "indéfini",
    null: "null",
    never: "jamais",
    void: "vide",
    date: "date",
    array: "tableau",
    object: "objet",
    tuple: "tuple",
    record: "enregistrement",
    map: "carte",
    set: "ensemble",
    file: "fichier",
    nonoptional: "non-optionnel",
    nan: "NaN",
    function: "fonction"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Entrée invalide : instanceof ${issue2.expected} attendu, ${received} reçu`;
        }
        return `Entrée invalide : ${expected} attendu, ${received} reçu`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrée invalide : ${stringifyPrimitive(issue2.values[0])} attendu`;
        return `Option invalide : une valeur parmi ${joinValues(issue2.values, "|")} attendue`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Trop grand : ${TypeDictionary[issue2.origin] ?? "valeur"} doit ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "élément(s)"}`;
        return `Trop grand : ${TypeDictionary[issue2.origin] ?? "valeur"} doit être ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Trop petit : ${TypeDictionary[issue2.origin] ?? "valeur"} doit ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        return `Trop petit : ${TypeDictionary[issue2.origin] ?? "valeur"} doit être ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Chaîne invalide : doit commencer par "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Chaîne invalide : doit se terminer par "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Chaîne invalide : doit inclure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Chaîne invalide : doit correspondre au modèle ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} invalide`;
      }
      case "not_multiple_of":
        return `Nombre invalide : doit être un multiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Clé${issue2.keys.length > 1 ? "s" : ""} non reconnue${issue2.keys.length > 1 ? "s" : ""} : ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Clé invalide dans ${issue2.origin}`;
      case "invalid_union":
        return "Entrée invalide";
      case "invalid_element":
        return `Valeur invalide dans ${issue2.origin}`;
      default:
        return `Entrée invalide`;
    }
  };
};
function fr_default() {
  return {
    localeError: error15()
  };
}

// node_modules/zod/v4/locales/fr-CA.js
var error16 = () => {
  const Sizable = {
    string: { unit: "caractères", verb: "avoir" },
    file: { unit: "octets", verb: "avoir" },
    array: { unit: "éléments", verb: "avoir" },
    set: { unit: "éléments", verb: "avoir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "entrée",
    email: "adresse courriel",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "date-heure ISO",
    date: "date ISO",
    time: "heure ISO",
    duration: "durée ISO",
    ipv4: "adresse IPv4",
    ipv6: "adresse IPv6",
    cidrv4: "plage IPv4",
    cidrv6: "plage IPv6",
    base64: "chaîne encodée en base64",
    base64url: "chaîne encodée en base64url",
    json_string: "chaîne JSON",
    e164: "numéro E.164",
    jwt: "JWT",
    template_literal: "entrée"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Entrée invalide : attendu instanceof ${issue2.expected}, reçu ${received}`;
        }
        return `Entrée invalide : attendu ${expected}, reçu ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrée invalide : attendu ${stringifyPrimitive(issue2.values[0])}`;
        return `Option invalide : attendu l'une des valeurs suivantes ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "≤" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Trop grand : attendu que ${issue2.origin ?? "la valeur"} ait ${adj}${issue2.maximum.toString()} ${sizing.unit}`;
        return `Trop grand : attendu que ${issue2.origin ?? "la valeur"} soit ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "≥" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Trop petit : attendu que ${issue2.origin} ait ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Trop petit : attendu que ${issue2.origin} soit ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Chaîne invalide : doit commencer par "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Chaîne invalide : doit se terminer par "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Chaîne invalide : doit inclure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Chaîne invalide : doit correspondre au motif ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} invalide`;
      }
      case "not_multiple_of":
        return `Nombre invalide : doit être un multiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Clé${issue2.keys.length > 1 ? "s" : ""} non reconnue${issue2.keys.length > 1 ? "s" : ""} : ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Clé invalide dans ${issue2.origin}`;
      case "invalid_union":
        return "Entrée invalide";
      case "invalid_element":
        return `Valeur invalide dans ${issue2.origin}`;
      default:
        return `Entrée invalide`;
    }
  };
};
function fr_CA_default() {
  return {
    localeError: error16()
  };
}

// node_modules/zod/v4/locales/he.js
var error17 = () => {
  const TypeNames = {
    string: { label: "מחרוזת", gender: "f" },
    number: { label: "מספר", gender: "m" },
    boolean: { label: "ערך בוליאני", gender: "m" },
    bigint: { label: "BigInt", gender: "m" },
    date: { label: "תאריך", gender: "m" },
    array: { label: "מערך", gender: "m" },
    object: { label: "אובייקט", gender: "m" },
    null: { label: "ערך ריק (null)", gender: "m" },
    undefined: { label: "ערך לא מוגדר (undefined)", gender: "m" },
    symbol: { label: "סימבול (Symbol)", gender: "m" },
    function: { label: "פונקציה", gender: "f" },
    map: { label: "מפה (Map)", gender: "f" },
    set: { label: "קבוצה (Set)", gender: "f" },
    file: { label: "קובץ", gender: "m" },
    promise: { label: "Promise", gender: "m" },
    NaN: { label: "NaN", gender: "m" },
    unknown: { label: "ערך לא ידוע", gender: "m" },
    value: { label: "ערך", gender: "m" }
  };
  const Sizable = {
    string: { unit: "תווים", shortLabel: "קצר", longLabel: "ארוך" },
    file: { unit: "בייטים", shortLabel: "קטן", longLabel: "גדול" },
    array: { unit: "פריטים", shortLabel: "קטן", longLabel: "גדול" },
    set: { unit: "פריטים", shortLabel: "קטן", longLabel: "גדול" },
    number: { unit: "", shortLabel: "קטן", longLabel: "גדול" }
    // no unit
  };
  const typeEntry = (t) => t ? TypeNames[t] : void 0;
  const typeLabel = (t) => {
    const e = typeEntry(t);
    if (e)
      return e.label;
    return t ?? TypeNames.unknown.label;
  };
  const withDefinite = (t) => `ה${typeLabel(t)}`;
  const verbFor = (t) => {
    const e = typeEntry(t);
    const gender = e?.gender ?? "m";
    return gender === "f" ? "צריכה להיות" : "צריך להיות";
  };
  const getSizing = (origin) => {
    if (!origin)
      return null;
    return Sizable[origin] ?? null;
  };
  const FormatDictionary = {
    regex: { label: "קלט", gender: "m" },
    email: { label: "כתובת אימייל", gender: "f" },
    url: { label: "כתובת רשת", gender: "f" },
    emoji: { label: "אימוג'י", gender: "m" },
    uuid: { label: "UUID", gender: "m" },
    nanoid: { label: "nanoid", gender: "m" },
    guid: { label: "GUID", gender: "m" },
    cuid: { label: "cuid", gender: "m" },
    cuid2: { label: "cuid2", gender: "m" },
    ulid: { label: "ULID", gender: "m" },
    xid: { label: "XID", gender: "m" },
    ksuid: { label: "KSUID", gender: "m" },
    datetime: { label: "תאריך וזמן ISO", gender: "m" },
    date: { label: "תאריך ISO", gender: "m" },
    time: { label: "זמן ISO", gender: "m" },
    duration: { label: "משך זמן ISO", gender: "m" },
    ipv4: { label: "כתובת IPv4", gender: "f" },
    ipv6: { label: "כתובת IPv6", gender: "f" },
    cidrv4: { label: "טווח IPv4", gender: "m" },
    cidrv6: { label: "טווח IPv6", gender: "m" },
    base64: { label: "מחרוזת בבסיס 64", gender: "f" },
    base64url: { label: "מחרוזת בבסיס 64 לכתובות רשת", gender: "f" },
    json_string: { label: "מחרוזת JSON", gender: "f" },
    e164: { label: "מספר E.164", gender: "m" },
    jwt: { label: "JWT", gender: "m" },
    ends_with: { label: "קלט", gender: "m" },
    includes: { label: "קלט", gender: "m" },
    lowercase: { label: "קלט", gender: "m" },
    starts_with: { label: "קלט", gender: "m" },
    uppercase: { label: "קלט", gender: "m" }
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expectedKey = issue2.expected;
        const expected = TypeDictionary[expectedKey ?? ""] ?? typeLabel(expectedKey);
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? TypeNames[receivedType]?.label ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `קלט לא תקין: צריך להיות instanceof ${issue2.expected}, התקבל ${received}`;
        }
        return `קלט לא תקין: צריך להיות ${expected}, התקבל ${received}`;
      }
      case "invalid_value": {
        if (issue2.values.length === 1) {
          return `ערך לא תקין: הערך חייב להיות ${stringifyPrimitive(issue2.values[0])}`;
        }
        const stringified = issue2.values.map((v) => stringifyPrimitive(v));
        if (issue2.values.length === 2) {
          return `ערך לא תקין: האפשרויות המתאימות הן ${stringified[0]} או ${stringified[1]}`;
        }
        const lastValue = stringified[stringified.length - 1];
        const restValues = stringified.slice(0, -1).join(", ");
        return `ערך לא תקין: האפשרויות המתאימות הן ${restValues} או ${lastValue}`;
      }
      case "too_big": {
        const sizing = getSizing(issue2.origin);
        const subject = withDefinite(issue2.origin ?? "value");
        if (issue2.origin === "string") {
          return `${sizing?.longLabel ?? "ארוך"} מדי: ${subject} צריכה להכיל ${issue2.maximum.toString()} ${sizing?.unit ?? ""} ${issue2.inclusive ? "או פחות" : "לכל היותר"}`.trim();
        }
        if (issue2.origin === "number") {
          const comparison = issue2.inclusive ? `קטן או שווה ל-${issue2.maximum}` : `קטן מ-${issue2.maximum}`;
          return `גדול מדי: ${subject} צריך להיות ${comparison}`;
        }
        if (issue2.origin === "array" || issue2.origin === "set") {
          const verb = issue2.origin === "set" ? "צריכה" : "צריך";
          const comparison = issue2.inclusive ? `${issue2.maximum} ${sizing?.unit ?? ""} או פחות` : `פחות מ-${issue2.maximum} ${sizing?.unit ?? ""}`;
          return `גדול מדי: ${subject} ${verb} להכיל ${comparison}`.trim();
        }
        const adj = issue2.inclusive ? "<=" : "<";
        const be = verbFor(issue2.origin ?? "value");
        if (sizing?.unit) {
          return `${sizing.longLabel} מדי: ${subject} ${be} ${adj}${issue2.maximum.toString()} ${sizing.unit}`;
        }
        return `${sizing?.longLabel ?? "גדול"} מדי: ${subject} ${be} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const sizing = getSizing(issue2.origin);
        const subject = withDefinite(issue2.origin ?? "value");
        if (issue2.origin === "string") {
          return `${sizing?.shortLabel ?? "קצר"} מדי: ${subject} צריכה להכיל ${issue2.minimum.toString()} ${sizing?.unit ?? ""} ${issue2.inclusive ? "או יותר" : "לפחות"}`.trim();
        }
        if (issue2.origin === "number") {
          const comparison = issue2.inclusive ? `גדול או שווה ל-${issue2.minimum}` : `גדול מ-${issue2.minimum}`;
          return `קטן מדי: ${subject} צריך להיות ${comparison}`;
        }
        if (issue2.origin === "array" || issue2.origin === "set") {
          const verb = issue2.origin === "set" ? "צריכה" : "צריך";
          if (issue2.minimum === 1 && issue2.inclusive) {
            const singularPhrase = issue2.origin === "set" ? "לפחות פריט אחד" : "לפחות פריט אחד";
            return `קטן מדי: ${subject} ${verb} להכיל ${singularPhrase}`;
          }
          const comparison = issue2.inclusive ? `${issue2.minimum} ${sizing?.unit ?? ""} או יותר` : `יותר מ-${issue2.minimum} ${sizing?.unit ?? ""}`;
          return `קטן מדי: ${subject} ${verb} להכיל ${comparison}`.trim();
        }
        const adj = issue2.inclusive ? ">=" : ">";
        const be = verbFor(issue2.origin ?? "value");
        if (sizing?.unit) {
          return `${sizing.shortLabel} מדי: ${subject} ${be} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `${sizing?.shortLabel ?? "קטן"} מדי: ${subject} ${be} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `המחרוזת חייבת להתחיל ב "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `המחרוזת חייבת להסתיים ב "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `המחרוזת חייבת לכלול "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `המחרוזת חייבת להתאים לתבנית ${_issue.pattern}`;
        const nounEntry = FormatDictionary[_issue.format];
        const noun = nounEntry?.label ?? _issue.format;
        const gender = nounEntry?.gender ?? "m";
        const adjective = gender === "f" ? "תקינה" : "תקין";
        return `${noun} לא ${adjective}`;
      }
      case "not_multiple_of":
        return `מספר לא תקין: חייב להיות מכפלה של ${issue2.divisor}`;
      case "unrecognized_keys":
        return `מפתח${issue2.keys.length > 1 ? "ות" : ""} לא מזוה${issue2.keys.length > 1 ? "ים" : "ה"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key": {
        return `שדה לא תקין באובייקט`;
      }
      case "invalid_union":
        return "קלט לא תקין";
      case "invalid_element": {
        const place = withDefinite(issue2.origin ?? "array");
        return `ערך לא תקין ב${place}`;
      }
      default:
        return `קלט לא תקין`;
    }
  };
};
function he_default() {
  return {
    localeError: error17()
  };
}

// node_modules/zod/v4/locales/hr.js
var error18 = () => {
  const Sizable = {
    string: { unit: "znakova", verb: "imati" },
    file: { unit: "bajtova", verb: "imati" },
    array: { unit: "stavki", verb: "imati" },
    set: { unit: "stavki", verb: "imati" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "unos",
    email: "email adresa",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datum i vrijeme",
    date: "ISO datum",
    time: "ISO vrijeme",
    duration: "ISO trajanje",
    ipv4: "IPv4 adresa",
    ipv6: "IPv6 adresa",
    cidrv4: "IPv4 raspon",
    cidrv6: "IPv6 raspon",
    base64: "base64 kodirani tekst",
    base64url: "base64url kodirani tekst",
    json_string: "JSON tekst",
    e164: "E.164 broj",
    jwt: "JWT",
    template_literal: "unos"
  };
  const TypeDictionary = {
    nan: "NaN",
    string: "tekst",
    number: "broj",
    boolean: "boolean",
    array: "niz",
    object: "objekt",
    set: "skup",
    file: "datoteka",
    date: "datum",
    bigint: "bigint",
    symbol: "simbol",
    undefined: "undefined",
    null: "null",
    function: "funkcija",
    map: "mapa"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Neispravan unos: očekuje se instanceof ${issue2.expected}, a primljeno je ${received}`;
        }
        return `Neispravan unos: očekuje se ${expected}, a primljeno je ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Neispravna vrijednost: očekivano ${stringifyPrimitive(issue2.values[0])}`;
        return `Neispravna opcija: očekivano jedno od ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing)
          return `Preveliko: očekivano da ${origin ?? "vrijednost"} ima ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemenata"}`;
        return `Preveliko: očekivano da ${origin ?? "vrijednost"} bude ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing) {
          return `Premalo: očekivano da ${origin} ima ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Premalo: očekivano da ${origin} bude ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Neispravan tekst: mora započinjati s "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Neispravan tekst: mora završavati s "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Neispravan tekst: mora sadržavati "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Neispravan tekst: mora odgovarati uzorku ${_issue.pattern}`;
        return `Neispravna ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Neispravan broj: mora biti višekratnik od ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Neprepoznat${issue2.keys.length > 1 ? "i ključevi" : " ključ"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Neispravan ključ u ${TypeDictionary[issue2.origin] ?? issue2.origin}`;
      case "invalid_union":
        return "Neispravan unos";
      case "invalid_element":
        return `Neispravna vrijednost u ${TypeDictionary[issue2.origin] ?? issue2.origin}`;
      default:
        return `Neispravan unos`;
    }
  };
};
function hr_default() {
  return {
    localeError: error18()
  };
}

// node_modules/zod/v4/locales/hu.js
var error19 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "legyen" },
    file: { unit: "byte", verb: "legyen" },
    array: { unit: "elem", verb: "legyen" },
    set: { unit: "elem", verb: "legyen" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "bemenet",
    email: "email cím",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO időbélyeg",
    date: "ISO dátum",
    time: "ISO idő",
    duration: "ISO időintervallum",
    ipv4: "IPv4 cím",
    ipv6: "IPv6 cím",
    cidrv4: "IPv4 tartomány",
    cidrv6: "IPv6 tartomány",
    base64: "base64-kódolt string",
    base64url: "base64url-kódolt string",
    json_string: "JSON string",
    e164: "E.164 szám",
    jwt: "JWT",
    template_literal: "bemenet"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "szám",
    array: "tömb"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Érvénytelen bemenet: a várt érték instanceof ${issue2.expected}, a kapott érték ${received}`;
        }
        return `Érvénytelen bemenet: a várt érték ${expected}, a kapott érték ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Érvénytelen bemenet: a várt érték ${stringifyPrimitive(issue2.values[0])}`;
        return `Érvénytelen opció: valamelyik érték várt ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Túl nagy: ${issue2.origin ?? "érték"} mérete túl nagy ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elem"}`;
        return `Túl nagy: a bemeneti érték ${issue2.origin ?? "érték"} túl nagy: ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Túl kicsi: a bemeneti érték ${issue2.origin} mérete túl kicsi ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Túl kicsi: a bemeneti érték ${issue2.origin} túl kicsi ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Érvénytelen string: "${_issue.prefix}" értékkel kell kezdődnie`;
        if (_issue.format === "ends_with")
          return `Érvénytelen string: "${_issue.suffix}" értékkel kell végződnie`;
        if (_issue.format === "includes")
          return `Érvénytelen string: "${_issue.includes}" értéket kell tartalmaznia`;
        if (_issue.format === "regex")
          return `Érvénytelen string: ${_issue.pattern} mintának kell megfelelnie`;
        return `Érvénytelen ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Érvénytelen szám: ${issue2.divisor} többszörösének kell lennie`;
      case "unrecognized_keys":
        return `Ismeretlen kulcs${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Érvénytelen kulcs ${issue2.origin}`;
      case "invalid_union":
        return "Érvénytelen bemenet";
      case "invalid_element":
        return `Érvénytelen érték: ${issue2.origin}`;
      default:
        return `Érvénytelen bemenet`;
    }
  };
};
function hu_default() {
  return {
    localeError: error19()
  };
}

// node_modules/zod/v4/locales/hy.js
function getArmenianPlural(count, one, many) {
  return Math.abs(count) === 1 ? one : many;
}
function withDefiniteArticle(word) {
  if (!word)
    return "";
  const vowels = ["ա", "ե", "ը", "ի", "ո", "ու", "օ"];
  const lastChar = word[word.length - 1];
  return word + (vowels.includes(lastChar) ? "ն" : "ը");
}
var error20 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "նշան",
        many: "նշաններ"
      },
      verb: "ունենալ"
    },
    file: {
      unit: {
        one: "բայթ",
        many: "բայթեր"
      },
      verb: "ունենալ"
    },
    array: {
      unit: {
        one: "տարր",
        many: "տարրեր"
      },
      verb: "ունենալ"
    },
    set: {
      unit: {
        one: "տարր",
        many: "տարրեր"
      },
      verb: "ունենալ"
    }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "մուտք",
    email: "էլ. հասցե",
    url: "URL",
    emoji: "էմոջի",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO ամսաթիվ և ժամ",
    date: "ISO ամսաթիվ",
    time: "ISO ժամ",
    duration: "ISO տևողություն",
    ipv4: "IPv4 հասցե",
    ipv6: "IPv6 հասցե",
    cidrv4: "IPv4 միջակայք",
    cidrv6: "IPv6 միջակայք",
    base64: "base64 ձևաչափով տող",
    base64url: "base64url ձևաչափով տող",
    json_string: "JSON տող",
    e164: "E.164 համար",
    jwt: "JWT",
    template_literal: "մուտք"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "թիվ",
    array: "զանգված"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Սխալ մուտքագրում․ սպասվում էր instanceof ${issue2.expected}, ստացվել է ${received}`;
        }
        return `Սխալ մուտքագրում․ սպասվում էր ${expected}, ստացվել է ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Սխալ մուտքագրում․ սպասվում էր ${stringifyPrimitive(issue2.values[1])}`;
        return `Սխալ տարբերակ․ սպասվում էր հետևյալներից մեկը՝ ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const maxValue = Number(issue2.maximum);
          const unit = getArmenianPlural(maxValue, sizing.unit.one, sizing.unit.many);
          return `Չափազանց մեծ արժեք․ սպասվում է, որ ${withDefiniteArticle(issue2.origin ?? "արժեք")} կունենա ${adj}${issue2.maximum.toString()} ${unit}`;
        }
        return `Չափազանց մեծ արժեք․ սպասվում է, որ ${withDefiniteArticle(issue2.origin ?? "արժեք")} լինի ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const minValue = Number(issue2.minimum);
          const unit = getArmenianPlural(minValue, sizing.unit.one, sizing.unit.many);
          return `Չափազանց փոքր արժեք․ սպասվում է, որ ${withDefiniteArticle(issue2.origin)} կունենա ${adj}${issue2.minimum.toString()} ${unit}`;
        }
        return `Չափազանց փոքր արժեք․ սպասվում է, որ ${withDefiniteArticle(issue2.origin)} լինի ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Սխալ տող․ պետք է սկսվի "${_issue.prefix}"-ով`;
        if (_issue.format === "ends_with")
          return `Սխալ տող․ պետք է ավարտվի "${_issue.suffix}"-ով`;
        if (_issue.format === "includes")
          return `Սխալ տող․ պետք է պարունակի "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Սխալ տող․ պետք է համապատասխանի ${_issue.pattern} ձևաչափին`;
        return `Սխալ ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Սխալ թիվ․ պետք է բազմապատիկ լինի ${issue2.divisor}-ի`;
      case "unrecognized_keys":
        return `Չճանաչված բանալի${issue2.keys.length > 1 ? "ներ" : ""}. ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Սխալ բանալի ${withDefiniteArticle(issue2.origin)}-ում`;
      case "invalid_union":
        return "Սխալ մուտքագրում";
      case "invalid_element":
        return `Սխալ արժեք ${withDefiniteArticle(issue2.origin)}-ում`;
      default:
        return `Սխալ մուտքագրում`;
    }
  };
};
function hy_default() {
  return {
    localeError: error20()
  };
}

// node_modules/zod/v4/locales/id.js
var error21 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "memiliki" },
    file: { unit: "byte", verb: "memiliki" },
    array: { unit: "item", verb: "memiliki" },
    set: { unit: "item", verb: "memiliki" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "alamat email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "tanggal dan waktu format ISO",
    date: "tanggal format ISO",
    time: "jam format ISO",
    duration: "durasi format ISO",
    ipv4: "alamat IPv4",
    ipv6: "alamat IPv6",
    cidrv4: "rentang alamat IPv4",
    cidrv6: "rentang alamat IPv6",
    base64: "string dengan enkode base64",
    base64url: "string dengan enkode base64url",
    json_string: "string JSON",
    e164: "angka E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Input tidak valid: diharapkan instanceof ${issue2.expected}, diterima ${received}`;
        }
        return `Input tidak valid: diharapkan ${expected}, diterima ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input tidak valid: diharapkan ${stringifyPrimitive(issue2.values[0])}`;
        return `Pilihan tidak valid: diharapkan salah satu dari ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Terlalu besar: diharapkan ${issue2.origin ?? "value"} memiliki ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemen"}`;
        return `Terlalu besar: diharapkan ${issue2.origin ?? "value"} menjadi ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Terlalu kecil: diharapkan ${issue2.origin} memiliki ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Terlalu kecil: diharapkan ${issue2.origin} menjadi ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `String tidak valid: harus dimulai dengan "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `String tidak valid: harus berakhir dengan "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `String tidak valid: harus menyertakan "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `String tidak valid: harus sesuai pola ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} tidak valid`;
      }
      case "not_multiple_of":
        return `Angka tidak valid: harus kelipatan dari ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Kunci tidak dikenali ${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Kunci tidak valid di ${issue2.origin}`;
      case "invalid_union":
        return "Input tidak valid";
      case "invalid_element":
        return `Nilai tidak valid di ${issue2.origin}`;
      default:
        return `Input tidak valid`;
    }
  };
};
function id_default() {
  return {
    localeError: error21()
  };
}

// node_modules/zod/v4/locales/is.js
var error22 = () => {
  const Sizable = {
    string: { unit: "stafi", verb: "að hafa" },
    file: { unit: "bæti", verb: "að hafa" },
    array: { unit: "hluti", verb: "að hafa" },
    set: { unit: "hluti", verb: "að hafa" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "gildi",
    email: "netfang",
    url: "vefslóð",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dagsetning og tími",
    date: "ISO dagsetning",
    time: "ISO tími",
    duration: "ISO tímalengd",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded strengur",
    base64url: "base64url-encoded strengur",
    json_string: "JSON strengur",
    e164: "E.164 tölugildi",
    jwt: "JWT",
    template_literal: "gildi"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "númer",
    array: "fylki"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Rangt gildi: Þú slóst inn ${received} þar sem á að vera instanceof ${issue2.expected}`;
        }
        return `Rangt gildi: Þú slóst inn ${received} þar sem á að vera ${expected}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Rangt gildi: gert ráð fyrir ${stringifyPrimitive(issue2.values[0])}`;
        return `Ógilt val: má vera eitt af eftirfarandi ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Of stórt: gert er ráð fyrir að ${issue2.origin ?? "gildi"} hafi ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "hluti"}`;
        return `Of stórt: gert er ráð fyrir að ${issue2.origin ?? "gildi"} sé ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Of lítið: gert er ráð fyrir að ${issue2.origin} hafi ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Of lítið: gert er ráð fyrir að ${issue2.origin} sé ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Ógildur strengur: verður að byrja á "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Ógildur strengur: verður að enda á "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ógildur strengur: verður að innihalda "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ógildur strengur: verður að fylgja mynstri ${_issue.pattern}`;
        return `Rangt ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Röng tala: verður að vera margfeldi af ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Óþekkt ${issue2.keys.length > 1 ? "ir lyklar" : "ur lykill"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Rangur lykill í ${issue2.origin}`;
      case "invalid_union":
        return "Rangt gildi";
      case "invalid_element":
        return `Rangt gildi í ${issue2.origin}`;
      default:
        return `Rangt gildi`;
    }
  };
};
function is_default() {
  return {
    localeError: error22()
  };
}

// node_modules/zod/v4/locales/it.js
var error23 = () => {
  const Sizable = {
    string: { unit: "caratteri", verb: "avere" },
    file: { unit: "byte", verb: "avere" },
    array: { unit: "elementi", verb: "avere" },
    set: { unit: "elementi", verb: "avere" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "indirizzo email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data e ora ISO",
    date: "data ISO",
    time: "ora ISO",
    duration: "durata ISO",
    ipv4: "indirizzo IPv4",
    ipv6: "indirizzo IPv6",
    cidrv4: "intervallo IPv4",
    cidrv6: "intervallo IPv6",
    base64: "stringa codificata in base64",
    base64url: "URL codificata in base64",
    json_string: "stringa JSON",
    e164: "numero E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "numero",
    array: "vettore"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Input non valido: atteso instanceof ${issue2.expected}, ricevuto ${received}`;
        }
        return `Input non valido: atteso ${expected}, ricevuto ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input non valido: atteso ${stringifyPrimitive(issue2.values[0])}`;
        return `Opzione non valida: atteso uno tra ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Troppo grande: ${issue2.origin ?? "valore"} deve avere ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementi"}`;
        return `Troppo grande: ${issue2.origin ?? "valore"} deve essere ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Troppo piccolo: ${issue2.origin} deve avere ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Troppo piccolo: ${issue2.origin} deve essere ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Stringa non valida: deve iniziare con "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Stringa non valida: deve terminare con "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Stringa non valida: deve includere "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Stringa non valida: deve corrispondere al pattern ${_issue.pattern}`;
        return `Input non valido: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Numero non valido: deve essere un multiplo di ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Chiav${issue2.keys.length > 1 ? "i" : "e"} non riconosciut${issue2.keys.length > 1 ? "e" : "a"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Chiave non valida in ${issue2.origin}`;
      case "invalid_union":
        return "Input non valido";
      case "invalid_element":
        return `Valore non valido in ${issue2.origin}`;
      default:
        return `Input non valido`;
    }
  };
};
function it_default() {
  return {
    localeError: error23()
  };
}

// node_modules/zod/v4/locales/ja.js
var error24 = () => {
  const Sizable = {
    string: { unit: "文字", verb: "である" },
    file: { unit: "バイト", verb: "である" },
    array: { unit: "要素", verb: "である" },
    set: { unit: "要素", verb: "である" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "入力値",
    email: "メールアドレス",
    url: "URL",
    emoji: "絵文字",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO日時",
    date: "ISO日付",
    time: "ISO時刻",
    duration: "ISO期間",
    ipv4: "IPv4アドレス",
    ipv6: "IPv6アドレス",
    cidrv4: "IPv4範囲",
    cidrv6: "IPv6範囲",
    base64: "base64エンコード文字列",
    base64url: "base64urlエンコード文字列",
    json_string: "JSON文字列",
    e164: "E.164番号",
    jwt: "JWT",
    template_literal: "入力値"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "数値",
    array: "配列"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `無効な入力: instanceof ${issue2.expected}が期待されましたが、${received}が入力されました`;
        }
        return `無効な入力: ${expected}が期待されましたが、${received}が入力されました`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `無効な入力: ${stringifyPrimitive(issue2.values[0])}が期待されました`;
        return `無効な選択: ${joinValues(issue2.values, "、")}のいずれかである必要があります`;
      case "too_big": {
        const adj = issue2.inclusive ? "以下である" : "より小さい";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `大きすぎる値: ${issue2.origin ?? "値"}は${issue2.maximum.toString()}${sizing.unit ?? "要素"}${adj}必要があります`;
        return `大きすぎる値: ${issue2.origin ?? "値"}は${issue2.maximum.toString()}${adj}必要があります`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "以上である" : "より大きい";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `小さすぎる値: ${issue2.origin}は${issue2.minimum.toString()}${sizing.unit}${adj}必要があります`;
        return `小さすぎる値: ${issue2.origin}は${issue2.minimum.toString()}${adj}必要があります`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `無効な文字列: "${_issue.prefix}"で始まる必要があります`;
        if (_issue.format === "ends_with")
          return `無効な文字列: "${_issue.suffix}"で終わる必要があります`;
        if (_issue.format === "includes")
          return `無効な文字列: "${_issue.includes}"を含む必要があります`;
        if (_issue.format === "regex")
          return `無効な文字列: パターン${_issue.pattern}に一致する必要があります`;
        return `無効な${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `無効な数値: ${issue2.divisor}の倍数である必要があります`;
      case "unrecognized_keys":
        return `認識されていないキー${issue2.keys.length > 1 ? "群" : ""}: ${joinValues(issue2.keys, "、")}`;
      case "invalid_key":
        return `${issue2.origin}内の無効なキー`;
      case "invalid_union":
        return "無効な入力";
      case "invalid_element":
        return `${issue2.origin}内の無効な値`;
      default:
        return `無効な入力`;
    }
  };
};
function ja_default() {
  return {
    localeError: error24()
  };
}

// node_modules/zod/v4/locales/ka.js
var error25 = () => {
  const Sizable = {
    string: { unit: "სიმბოლო", verb: "უნდა შეიცავდეს" },
    file: { unit: "ბაიტი", verb: "უნდა შეიცავდეს" },
    array: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" },
    set: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "შეყვანა",
    email: "ელ-ფოსტის მისამართი",
    url: "URL",
    emoji: "ემოჯი",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "თარიღი-დრო",
    date: "თარიღი",
    time: "დრო",
    duration: "ხანგრძლივობა",
    ipv4: "IPv4 მისამართი",
    ipv6: "IPv6 მისამართი",
    cidrv4: "IPv4 დიაპაზონი",
    cidrv6: "IPv6 დიაპაზონი",
    base64: "base64-კოდირებული ველი",
    base64url: "base64url-კოდირებული ველი",
    json_string: "JSON ველი",
    e164: "E.164 ნომერი",
    jwt: "JWT",
    template_literal: "შეყვანა"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "რიცხვი",
    string: "ველი",
    boolean: "ბულეანი",
    function: "ფუნქცია",
    array: "მასივი"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `არასწორი შეყვანა: მოსალოდნელი instanceof ${issue2.expected}, მიღებული ${received}`;
        }
        return `არასწორი შეყვანა: მოსალოდნელი ${expected}, მიღებული ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `არასწორი შეყვანა: მოსალოდნელი ${stringifyPrimitive(issue2.values[0])}`;
        return `არასწორი ვარიანტი: მოსალოდნელია ერთ-ერთი ${joinValues(issue2.values, "|")}-დან`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `ზედმეტად დიდი: მოსალოდნელი ${issue2.origin ?? "მნიშვნელობა"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit}`;
        return `ზედმეტად დიდი: მოსალოდნელი ${issue2.origin ?? "მნიშვნელობა"} იყოს ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `ზედმეტად პატარა: მოსალოდნელი ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `ზედმეტად პატარა: მოსალოდნელი ${issue2.origin} იყოს ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `არასწორი ველი: უნდა იწყებოდეს "${_issue.prefix}"-ით`;
        }
        if (_issue.format === "ends_with")
          return `არასწორი ველი: უნდა მთავრდებოდეს "${_issue.suffix}"-ით`;
        if (_issue.format === "includes")
          return `არასწორი ველი: უნდა შეიცავდეს "${_issue.includes}"-ს`;
        if (_issue.format === "regex")
          return `არასწორი ველი: უნდა შეესაბამებოდეს შაბლონს ${_issue.pattern}`;
        return `არასწორი ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `არასწორი რიცხვი: უნდა იყოს ${issue2.divisor}-ის ჯერადი`;
      case "unrecognized_keys":
        return `უცნობი გასაღებ${issue2.keys.length > 1 ? "ები" : "ი"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `არასწორი გასაღები ${issue2.origin}-ში`;
      case "invalid_union":
        return "არასწორი შეყვანა";
      case "invalid_element":
        return `არასწორი მნიშვნელობა ${issue2.origin}-ში`;
      default:
        return `არასწორი შეყვანა`;
    }
  };
};
function ka_default() {
  return {
    localeError: error25()
  };
}

// node_modules/zod/v4/locales/km.js
var error26 = () => {
  const Sizable = {
    string: { unit: "តួអក្សរ", verb: "គួរមាន" },
    file: { unit: "បៃ", verb: "គួរមាន" },
    array: { unit: "ធាតុ", verb: "គួរមាន" },
    set: { unit: "ធាតុ", verb: "គួរមាន" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "ទិន្នន័យបញ្ចូល",
    email: "អាសយដ្ឋានអ៊ីមែល",
    url: "URL",
    emoji: "សញ្ញាអារម្មណ៍",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "កាលបរិច្ឆេទ និងម៉ោង ISO",
    date: "កាលបរិច្ឆេទ ISO",
    time: "ម៉ោង ISO",
    duration: "រយៈពេល ISO",
    ipv4: "អាសយដ្ឋាន IPv4",
    ipv6: "អាសយដ្ឋាន IPv6",
    cidrv4: "ដែនអាសយដ្ឋាន IPv4",
    cidrv6: "ដែនអាសយដ្ឋាន IPv6",
    base64: "ខ្សែអក្សរអ៊ិកូដ base64",
    base64url: "ខ្សែអក្សរអ៊ិកូដ base64url",
    json_string: "ខ្សែអក្សរ JSON",
    e164: "លេខ E.164",
    jwt: "JWT",
    template_literal: "ទិន្នន័យបញ្ចូល"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "លេខ",
    array: "អារេ (Array)",
    null: "គ្មានតម្លៃ (null)"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ instanceof ${issue2.expected} ប៉ុន្តែទទួលបាន ${received}`;
        }
        return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ ${expected} ប៉ុន្តែទទួលបាន ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ ${stringifyPrimitive(issue2.values[0])}`;
        return `ជម្រើសមិនត្រឹមត្រូវ៖ ត្រូវជាមួយក្នុងចំណោម ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `ធំពេក៖ ត្រូវការ ${issue2.origin ?? "តម្លៃ"} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "ធាតុ"}`;
        return `ធំពេក៖ ត្រូវការ ${issue2.origin ?? "តម្លៃ"} ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `តូចពេក៖ ត្រូវការ ${issue2.origin} ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `តូចពេក៖ ត្រូវការ ${issue2.origin} ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវចាប់ផ្តើមដោយ "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវបញ្ចប់ដោយ "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវមាន "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវតែផ្គូផ្គងនឹងទម្រង់ដែលបានកំណត់ ${_issue.pattern}`;
        return `មិនត្រឹមត្រូវ៖ ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `លេខមិនត្រឹមត្រូវ៖ ត្រូវតែជាពហុគុណនៃ ${issue2.divisor}`;
      case "unrecognized_keys":
        return `រកឃើញសោមិនស្គាល់៖ ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `សោមិនត្រឹមត្រូវនៅក្នុង ${issue2.origin}`;
      case "invalid_union":
        return `ទិន្នន័យមិនត្រឹមត្រូវ`;
      case "invalid_element":
        return `ទិន្នន័យមិនត្រឹមត្រូវនៅក្នុង ${issue2.origin}`;
      default:
        return `ទិន្នន័យមិនត្រឹមត្រូវ`;
    }
  };
};
function km_default() {
  return {
    localeError: error26()
  };
}

// node_modules/zod/v4/locales/kh.js
function kh_default() {
  return km_default();
}

// node_modules/zod/v4/locales/ko.js
var error27 = () => {
  const Sizable = {
    string: { unit: "문자", verb: "to have" },
    file: { unit: "바이트", verb: "to have" },
    array: { unit: "개", verb: "to have" },
    set: { unit: "개", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "입력",
    email: "이메일 주소",
    url: "URL",
    emoji: "이모지",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO 날짜시간",
    date: "ISO 날짜",
    time: "ISO 시간",
    duration: "ISO 기간",
    ipv4: "IPv4 주소",
    ipv6: "IPv6 주소",
    cidrv4: "IPv4 범위",
    cidrv6: "IPv6 범위",
    base64: "base64 인코딩 문자열",
    base64url: "base64url 인코딩 문자열",
    json_string: "JSON 문자열",
    e164: "E.164 번호",
    jwt: "JWT",
    template_literal: "입력"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `잘못된 입력: 예상 타입은 instanceof ${issue2.expected}, 받은 타입은 ${received}입니다`;
        }
        return `잘못된 입력: 예상 타입은 ${expected}, 받은 타입은 ${received}입니다`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `잘못된 입력: 값은 ${stringifyPrimitive(issue2.values[0])} 이어야 합니다`;
        return `잘못된 옵션: ${joinValues(issue2.values, "또는 ")} 중 하나여야 합니다`;
      case "too_big": {
        const adj = issue2.inclusive ? "이하" : "미만";
        const suffix = adj === "미만" ? "이어야 합니다" : "여야 합니다";
        const sizing = getSizing(issue2.origin);
        const unit = sizing?.unit ?? "요소";
        if (sizing)
          return `${issue2.origin ?? "값"}이 너무 큽니다: ${issue2.maximum.toString()}${unit} ${adj}${suffix}`;
        return `${issue2.origin ?? "값"}이 너무 큽니다: ${issue2.maximum.toString()} ${adj}${suffix}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "이상" : "초과";
        const suffix = adj === "이상" ? "이어야 합니다" : "여야 합니다";
        const sizing = getSizing(issue2.origin);
        const unit = sizing?.unit ?? "요소";
        if (sizing) {
          return `${issue2.origin ?? "값"}이 너무 작습니다: ${issue2.minimum.toString()}${unit} ${adj}${suffix}`;
        }
        return `${issue2.origin ?? "값"}이 너무 작습니다: ${issue2.minimum.toString()} ${adj}${suffix}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `잘못된 문자열: "${_issue.prefix}"(으)로 시작해야 합니다`;
        }
        if (_issue.format === "ends_with")
          return `잘못된 문자열: "${_issue.suffix}"(으)로 끝나야 합니다`;
        if (_issue.format === "includes")
          return `잘못된 문자열: "${_issue.includes}"을(를) 포함해야 합니다`;
        if (_issue.format === "regex")
          return `잘못된 문자열: 정규식 ${_issue.pattern} 패턴과 일치해야 합니다`;
        return `잘못된 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `잘못된 숫자: ${issue2.divisor}의 배수여야 합니다`;
      case "unrecognized_keys":
        return `인식할 수 없는 키: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `잘못된 키: ${issue2.origin}`;
      case "invalid_union":
        return `잘못된 입력`;
      case "invalid_element":
        return `잘못된 값: ${issue2.origin}`;
      default:
        return `잘못된 입력`;
    }
  };
};
function ko_default() {
  return {
    localeError: error27()
  };
}

// node_modules/zod/v4/locales/lt.js
var capitalizeFirstCharacter = (text) => {
  return text.charAt(0).toUpperCase() + text.slice(1);
};
function getUnitTypeFromNumber(number4) {
  const abs = Math.abs(number4);
  const last = abs % 10;
  const last2 = abs % 100;
  if (last2 >= 11 && last2 <= 19 || last === 0)
    return "many";
  if (last === 1)
    return "one";
  return "few";
}
var error28 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "simbolis",
        few: "simboliai",
        many: "simbolių"
      },
      verb: {
        smaller: {
          inclusive: "turi būti ne ilgesnė kaip",
          notInclusive: "turi būti trumpesnė kaip"
        },
        bigger: {
          inclusive: "turi būti ne trumpesnė kaip",
          notInclusive: "turi būti ilgesnė kaip"
        }
      }
    },
    file: {
      unit: {
        one: "baitas",
        few: "baitai",
        many: "baitų"
      },
      verb: {
        smaller: {
          inclusive: "turi būti ne didesnis kaip",
          notInclusive: "turi būti mažesnis kaip"
        },
        bigger: {
          inclusive: "turi būti ne mažesnis kaip",
          notInclusive: "turi būti didesnis kaip"
        }
      }
    },
    array: {
      unit: {
        one: "elementą",
        few: "elementus",
        many: "elementų"
      },
      verb: {
        smaller: {
          inclusive: "turi turėti ne daugiau kaip",
          notInclusive: "turi turėti mažiau kaip"
        },
        bigger: {
          inclusive: "turi turėti ne mažiau kaip",
          notInclusive: "turi turėti daugiau kaip"
        }
      }
    },
    set: {
      unit: {
        one: "elementą",
        few: "elementus",
        many: "elementų"
      },
      verb: {
        smaller: {
          inclusive: "turi turėti ne daugiau kaip",
          notInclusive: "turi turėti mažiau kaip"
        },
        bigger: {
          inclusive: "turi turėti ne mažiau kaip",
          notInclusive: "turi turėti daugiau kaip"
        }
      }
    }
  };
  function getSizing(origin, unitType, inclusive, targetShouldBe) {
    const result = Sizable[origin] ?? null;
    if (result === null)
      return result;
    return {
      unit: result.unit[unitType],
      verb: result.verb[targetShouldBe][inclusive ? "inclusive" : "notInclusive"]
    };
  }
  const FormatDictionary = {
    regex: "įvestis",
    email: "el. pašto adresas",
    url: "URL",
    emoji: "jaustukas",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO data ir laikas",
    date: "ISO data",
    time: "ISO laikas",
    duration: "ISO trukmė",
    ipv4: "IPv4 adresas",
    ipv6: "IPv6 adresas",
    cidrv4: "IPv4 tinklo prefiksas (CIDR)",
    cidrv6: "IPv6 tinklo prefiksas (CIDR)",
    base64: "base64 užkoduota eilutė",
    base64url: "base64url užkoduota eilutė",
    json_string: "JSON eilutė",
    e164: "E.164 numeris",
    jwt: "JWT",
    template_literal: "įvestis"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "skaičius",
    bigint: "sveikasis skaičius",
    string: "eilutė",
    boolean: "loginė reikšmė",
    undefined: "neapibrėžta reikšmė",
    function: "funkcija",
    symbol: "simbolis",
    array: "masyvas",
    object: "objektas",
    null: "nulinė reikšmė"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Gautas tipas ${received}, o tikėtasi - instanceof ${issue2.expected}`;
        }
        return `Gautas tipas ${received}, o tikėtasi - ${expected}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Privalo būti ${stringifyPrimitive(issue2.values[0])}`;
        return `Privalo būti vienas iš ${joinValues(issue2.values, "|")} pasirinkimų`;
      case "too_big": {
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        const sizing = getSizing(issue2.origin, getUnitTypeFromNumber(Number(issue2.maximum)), issue2.inclusive ?? false, "smaller");
        if (sizing?.verb)
          return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} ${sizing.verb} ${issue2.maximum.toString()} ${sizing.unit ?? "elementų"}`;
        const adj = issue2.inclusive ? "ne didesnis kaip" : "mažesnis kaip";
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} turi būti ${adj} ${issue2.maximum.toString()} ${sizing?.unit}`;
      }
      case "too_small": {
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        const sizing = getSizing(issue2.origin, getUnitTypeFromNumber(Number(issue2.minimum)), issue2.inclusive ?? false, "bigger");
        if (sizing?.verb)
          return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} ${sizing.verb} ${issue2.minimum.toString()} ${sizing.unit ?? "elementų"}`;
        const adj = issue2.inclusive ? "ne mažesnis kaip" : "didesnis kaip";
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} turi būti ${adj} ${issue2.minimum.toString()} ${sizing?.unit}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Eilutė privalo prasidėti "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Eilutė privalo pasibaigti "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Eilutė privalo įtraukti "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Eilutė privalo atitikti ${_issue.pattern}`;
        return `Neteisingas ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Skaičius privalo būti ${issue2.divisor} kartotinis.`;
      case "unrecognized_keys":
        return `Neatpažint${issue2.keys.length > 1 ? "i" : "as"} rakt${issue2.keys.length > 1 ? "ai" : "as"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return "Rastas klaidingas raktas";
      case "invalid_union":
        return "Klaidinga įvestis";
      case "invalid_element": {
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} turi klaidingą įvestį`;
      }
      default:
        return "Klaidinga įvestis";
    }
  };
};
function lt_default() {
  return {
    localeError: error28()
  };
}

// node_modules/zod/v4/locales/mk.js
var error29 = () => {
  const Sizable = {
    string: { unit: "знаци", verb: "да имаат" },
    file: { unit: "бајти", verb: "да имаат" },
    array: { unit: "ставки", verb: "да имаат" },
    set: { unit: "ставки", verb: "да имаат" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "внес",
    email: "адреса на е-пошта",
    url: "URL",
    emoji: "емоџи",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO датум и време",
    date: "ISO датум",
    time: "ISO време",
    duration: "ISO времетраење",
    ipv4: "IPv4 адреса",
    ipv6: "IPv6 адреса",
    cidrv4: "IPv4 опсег",
    cidrv6: "IPv6 опсег",
    base64: "base64-енкодирана низа",
    base64url: "base64url-енкодирана низа",
    json_string: "JSON низа",
    e164: "E.164 број",
    jwt: "JWT",
    template_literal: "внес"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "број",
    array: "низа"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Грешен внес: се очекува instanceof ${issue2.expected}, примено ${received}`;
        }
        return `Грешен внес: се очекува ${expected}, примено ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Грешана опција: се очекува една ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Премногу голем: се очекува ${issue2.origin ?? "вредноста"} да има ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "елементи"}`;
        return `Премногу голем: се очекува ${issue2.origin ?? "вредноста"} да биде ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Премногу мал: се очекува ${issue2.origin} да има ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Премногу мал: се очекува ${issue2.origin} да биде ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Неважечка низа: мора да започнува со "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Неважечка низа: мора да завршува со "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Неважечка низа: мора да вклучува "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Неважечка низа: мора да одгоара на патернот ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Грешен број: мора да биде делив со ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Непрепознаени клучеви" : "Непрепознаен клуч"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Грешен клуч во ${issue2.origin}`;
      case "invalid_union":
        return "Грешен внес";
      case "invalid_element":
        return `Грешна вредност во ${issue2.origin}`;
      default:
        return `Грешен внес`;
    }
  };
};
function mk_default() {
  return {
    localeError: error29()
  };
}

// node_modules/zod/v4/locales/ms.js
var error30 = () => {
  const Sizable = {
    string: { unit: "aksara", verb: "mempunyai" },
    file: { unit: "bait", verb: "mempunyai" },
    array: { unit: "elemen", verb: "mempunyai" },
    set: { unit: "elemen", verb: "mempunyai" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "alamat e-mel",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "tarikh masa ISO",
    date: "tarikh ISO",
    time: "masa ISO",
    duration: "tempoh ISO",
    ipv4: "alamat IPv4",
    ipv6: "alamat IPv6",
    cidrv4: "julat IPv4",
    cidrv6: "julat IPv6",
    base64: "string dikodkan base64",
    base64url: "string dikodkan base64url",
    json_string: "string JSON",
    e164: "nombor E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "nombor"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Input tidak sah: dijangka instanceof ${issue2.expected}, diterima ${received}`;
        }
        return `Input tidak sah: dijangka ${expected}, diterima ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input tidak sah: dijangka ${stringifyPrimitive(issue2.values[0])}`;
        return `Pilihan tidak sah: dijangka salah satu daripada ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Terlalu besar: dijangka ${issue2.origin ?? "nilai"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemen"}`;
        return `Terlalu besar: dijangka ${issue2.origin ?? "nilai"} adalah ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Terlalu kecil: dijangka ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Terlalu kecil: dijangka ${issue2.origin} adalah ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `String tidak sah: mesti bermula dengan "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `String tidak sah: mesti berakhir dengan "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `String tidak sah: mesti mengandungi "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `String tidak sah: mesti sepadan dengan corak ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} tidak sah`;
      }
      case "not_multiple_of":
        return `Nombor tidak sah: perlu gandaan ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Kunci tidak dikenali: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Kunci tidak sah dalam ${issue2.origin}`;
      case "invalid_union":
        return "Input tidak sah";
      case "invalid_element":
        return `Nilai tidak sah dalam ${issue2.origin}`;
      default:
        return `Input tidak sah`;
    }
  };
};
function ms_default() {
  return {
    localeError: error30()
  };
}

// node_modules/zod/v4/locales/nl.js
var error31 = () => {
  const Sizable = {
    string: { unit: "tekens", verb: "heeft" },
    file: { unit: "bytes", verb: "heeft" },
    array: { unit: "elementen", verb: "heeft" },
    set: { unit: "elementen", verb: "heeft" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "invoer",
    email: "emailadres",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datum en tijd",
    date: "ISO datum",
    time: "ISO tijd",
    duration: "ISO duur",
    ipv4: "IPv4-adres",
    ipv6: "IPv6-adres",
    cidrv4: "IPv4-bereik",
    cidrv6: "IPv6-bereik",
    base64: "base64-gecodeerde tekst",
    base64url: "base64 URL-gecodeerde tekst",
    json_string: "JSON string",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "invoer"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "getal"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ongeldige invoer: verwacht instanceof ${issue2.expected}, ontving ${received}`;
        }
        return `Ongeldige invoer: verwacht ${expected}, ontving ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ongeldige invoer: verwacht ${stringifyPrimitive(issue2.values[0])}`;
        return `Ongeldige optie: verwacht één van ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const longName = issue2.origin === "date" ? "laat" : issue2.origin === "string" ? "lang" : "groot";
        if (sizing)
          return `Te ${longName}: verwacht dat ${issue2.origin ?? "waarde"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementen"} ${sizing.verb}`;
        return `Te ${longName}: verwacht dat ${issue2.origin ?? "waarde"} ${adj}${issue2.maximum.toString()} is`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const shortName = issue2.origin === "date" ? "vroeg" : issue2.origin === "string" ? "kort" : "klein";
        if (sizing) {
          return `Te ${shortName}: verwacht dat ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
        }
        return `Te ${shortName}: verwacht dat ${issue2.origin} ${adj}${issue2.minimum.toString()} is`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Ongeldige tekst: moet met "${_issue.prefix}" beginnen`;
        }
        if (_issue.format === "ends_with")
          return `Ongeldige tekst: moet op "${_issue.suffix}" eindigen`;
        if (_issue.format === "includes")
          return `Ongeldige tekst: moet "${_issue.includes}" bevatten`;
        if (_issue.format === "regex")
          return `Ongeldige tekst: moet overeenkomen met patroon ${_issue.pattern}`;
        return `Ongeldig: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ongeldig getal: moet een veelvoud van ${issue2.divisor} zijn`;
      case "unrecognized_keys":
        return `Onbekende key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ongeldige key in ${issue2.origin}`;
      case "invalid_union":
        return "Ongeldige invoer";
      case "invalid_element":
        return `Ongeldige waarde in ${issue2.origin}`;
      default:
        return `Ongeldige invoer`;
    }
  };
};
function nl_default() {
  return {
    localeError: error31()
  };
}

// node_modules/zod/v4/locales/no.js
var error32 = () => {
  const Sizable = {
    string: { unit: "tegn", verb: "å ha" },
    file: { unit: "bytes", verb: "å ha" },
    array: { unit: "elementer", verb: "å inneholde" },
    set: { unit: "elementer", verb: "å inneholde" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "e-postadresse",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dato- og klokkeslett",
    date: "ISO-dato",
    time: "ISO-klokkeslett",
    duration: "ISO-varighet",
    ipv4: "IPv4-område",
    ipv6: "IPv6-område",
    cidrv4: "IPv4-spekter",
    cidrv6: "IPv6-spekter",
    base64: "base64-enkodet streng",
    base64url: "base64url-enkodet streng",
    json_string: "JSON-streng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "tall",
    array: "liste"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ugyldig input: forventet instanceof ${issue2.expected}, fikk ${received}`;
        }
        return `Ugyldig input: forventet ${expected}, fikk ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ugyldig verdi: forventet ${stringifyPrimitive(issue2.values[0])}`;
        return `Ugyldig valg: forventet en av ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `For stor(t): forventet ${issue2.origin ?? "value"} til å ha ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementer"}`;
        return `For stor(t): forventet ${issue2.origin ?? "value"} til å ha ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `For lite(n): forventet ${issue2.origin} til å ha ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `For lite(n): forventet ${issue2.origin} til å ha ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ugyldig streng: må starte med "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Ugyldig streng: må ende med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ugyldig streng: må inneholde "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ugyldig streng: må matche mønsteret ${_issue.pattern}`;
        return `Ugyldig ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ugyldig tall: må være et multiplum av ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Ukjente nøkler" : "Ukjent nøkkel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ugyldig nøkkel i ${issue2.origin}`;
      case "invalid_union":
        return "Ugyldig input";
      case "invalid_element":
        return `Ugyldig verdi i ${issue2.origin}`;
      default:
        return `Ugyldig input`;
    }
  };
};
function no_default() {
  return {
    localeError: error32()
  };
}

// node_modules/zod/v4/locales/ota.js
var error33 = () => {
  const Sizable = {
    string: { unit: "harf", verb: "olmalıdır" },
    file: { unit: "bayt", verb: "olmalıdır" },
    array: { unit: "unsur", verb: "olmalıdır" },
    set: { unit: "unsur", verb: "olmalıdır" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "giren",
    email: "epostagâh",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO hengâmı",
    date: "ISO tarihi",
    time: "ISO zamanı",
    duration: "ISO müddeti",
    ipv4: "IPv4 nişânı",
    ipv6: "IPv6 nişânı",
    cidrv4: "IPv4 menzili",
    cidrv6: "IPv6 menzili",
    base64: "base64-şifreli metin",
    base64url: "base64url-şifreli metin",
    json_string: "JSON metin",
    e164: "E.164 sayısı",
    jwt: "JWT",
    template_literal: "giren"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "numara",
    array: "saf",
    null: "gayb"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Fâsit giren: umulan instanceof ${issue2.expected}, alınan ${received}`;
        }
        return `Fâsit giren: umulan ${expected}, alınan ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Fâsit giren: umulan ${stringifyPrimitive(issue2.values[0])}`;
        return `Fâsit tercih: mûteberler ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Fazla büyük: ${issue2.origin ?? "value"}, ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"} sahip olmalıydı.`;
        return `Fazla büyük: ${issue2.origin ?? "value"}, ${adj}${issue2.maximum.toString()} olmalıydı.`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Fazla küçük: ${issue2.origin}, ${adj}${issue2.minimum.toString()} ${sizing.unit} sahip olmalıydı.`;
        }
        return `Fazla küçük: ${issue2.origin}, ${adj}${issue2.minimum.toString()} olmalıydı.`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Fâsit metin: "${_issue.prefix}" ile başlamalı.`;
        if (_issue.format === "ends_with")
          return `Fâsit metin: "${_issue.suffix}" ile bitmeli.`;
        if (_issue.format === "includes")
          return `Fâsit metin: "${_issue.includes}" ihtivâ etmeli.`;
        if (_issue.format === "regex")
          return `Fâsit metin: ${_issue.pattern} nakşına uymalı.`;
        return `Fâsit ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Fâsit sayı: ${issue2.divisor} katı olmalıydı.`;
      case "unrecognized_keys":
        return `Tanınmayan anahtar ${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} için tanınmayan anahtar var.`;
      case "invalid_union":
        return "Giren tanınamadı.";
      case "invalid_element":
        return `${issue2.origin} için tanınmayan kıymet var.`;
      default:
        return `Kıymet tanınamadı.`;
    }
  };
};
function ota_default() {
  return {
    localeError: error33()
  };
}

// node_modules/zod/v4/locales/ps.js
var error34 = () => {
  const Sizable = {
    string: { unit: "توکي", verb: "ولري" },
    file: { unit: "بایټس", verb: "ولري" },
    array: { unit: "توکي", verb: "ولري" },
    set: { unit: "توکي", verb: "ولري" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "ورودي",
    email: "بریښنالیک",
    url: "یو آر ال",
    emoji: "ایموجي",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "نیټه او وخت",
    date: "نېټه",
    time: "وخت",
    duration: "موده",
    ipv4: "د IPv4 پته",
    ipv6: "د IPv6 پته",
    cidrv4: "د IPv4 ساحه",
    cidrv6: "د IPv6 ساحه",
    base64: "base64-encoded متن",
    base64url: "base64url-encoded متن",
    json_string: "JSON متن",
    e164: "د E.164 شمېره",
    jwt: "JWT",
    template_literal: "ورودي"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "عدد",
    array: "ارې"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `ناسم ورودي: باید instanceof ${issue2.expected} وای, مګر ${received} ترلاسه شو`;
        }
        return `ناسم ورودي: باید ${expected} وای, مګر ${received} ترلاسه شو`;
      }
      case "invalid_value":
        if (issue2.values.length === 1) {
          return `ناسم ورودي: باید ${stringifyPrimitive(issue2.values[0])} وای`;
        }
        return `ناسم انتخاب: باید یو له ${joinValues(issue2.values, "|")} څخه وای`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `ډیر لوی: ${issue2.origin ?? "ارزښت"} باید ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "عنصرونه"} ولري`;
        }
        return `ډیر لوی: ${issue2.origin ?? "ارزښت"} باید ${adj}${issue2.maximum.toString()} وي`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `ډیر کوچنی: ${issue2.origin} باید ${adj}${issue2.minimum.toString()} ${sizing.unit} ولري`;
        }
        return `ډیر کوچنی: ${issue2.origin} باید ${adj}${issue2.minimum.toString()} وي`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `ناسم متن: باید د "${_issue.prefix}" سره پیل شي`;
        }
        if (_issue.format === "ends_with") {
          return `ناسم متن: باید د "${_issue.suffix}" سره پای ته ورسيږي`;
        }
        if (_issue.format === "includes") {
          return `ناسم متن: باید "${_issue.includes}" ولري`;
        }
        if (_issue.format === "regex") {
          return `ناسم متن: باید د ${_issue.pattern} سره مطابقت ولري`;
        }
        return `${FormatDictionary[_issue.format] ?? issue2.format} ناسم دی`;
      }
      case "not_multiple_of":
        return `ناسم عدد: باید د ${issue2.divisor} مضرب وي`;
      case "unrecognized_keys":
        return `ناسم ${issue2.keys.length > 1 ? "کلیډونه" : "کلیډ"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `ناسم کلیډ په ${issue2.origin} کې`;
      case "invalid_union":
        return `ناسمه ورودي`;
      case "invalid_element":
        return `ناسم عنصر په ${issue2.origin} کې`;
      default:
        return `ناسمه ورودي`;
    }
  };
};
function ps_default() {
  return {
    localeError: error34()
  };
}

// node_modules/zod/v4/locales/pl.js
var error35 = () => {
  const Sizable = {
    string: { unit: "znaków", verb: "mieć" },
    file: { unit: "bajtów", verb: "mieć" },
    array: { unit: "elementów", verb: "mieć" },
    set: { unit: "elementów", verb: "mieć" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "wyrażenie",
    email: "adres email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data i godzina w formacie ISO",
    date: "data w formacie ISO",
    time: "godzina w formacie ISO",
    duration: "czas trwania ISO",
    ipv4: "adres IPv4",
    ipv6: "adres IPv6",
    cidrv4: "zakres IPv4",
    cidrv6: "zakres IPv6",
    base64: "ciąg znaków zakodowany w formacie base64",
    base64url: "ciąg znaków zakodowany w formacie base64url",
    json_string: "ciąg znaków w formacie JSON",
    e164: "liczba E.164",
    jwt: "JWT",
    template_literal: "wejście"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "liczba",
    array: "tablica"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Nieprawidłowe dane wejściowe: oczekiwano instanceof ${issue2.expected}, otrzymano ${received}`;
        }
        return `Nieprawidłowe dane wejściowe: oczekiwano ${expected}, otrzymano ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Nieprawidłowe dane wejściowe: oczekiwano ${stringifyPrimitive(issue2.values[0])}`;
        return `Nieprawidłowa opcja: oczekiwano jednej z wartości ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Za duża wartość: oczekiwano, że ${issue2.origin ?? "wartość"} będzie mieć ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementów"}`;
        }
        return `Zbyt duż(y/a/e): oczekiwano, że ${issue2.origin ?? "wartość"} będzie wynosić ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Za mała wartość: oczekiwano, że ${issue2.origin ?? "wartość"} będzie mieć ${adj}${issue2.minimum.toString()} ${sizing.unit ?? "elementów"}`;
        }
        return `Zbyt mał(y/a/e): oczekiwano, że ${issue2.origin ?? "wartość"} będzie wynosić ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Nieprawidłowy ciąg znaków: musi zaczynać się od "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Nieprawidłowy ciąg znaków: musi kończyć się na "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Nieprawidłowy ciąg znaków: musi zawierać "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Nieprawidłowy ciąg znaków: musi odpowiadać wzorcowi ${_issue.pattern}`;
        return `Nieprawidłow(y/a/e) ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Nieprawidłowa liczba: musi być wielokrotnością ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Nierozpoznane klucze${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Nieprawidłowy klucz w ${issue2.origin}`;
      case "invalid_union":
        return "Nieprawidłowe dane wejściowe";
      case "invalid_element":
        return `Nieprawidłowa wartość w ${issue2.origin}`;
      default:
        return `Nieprawidłowe dane wejściowe`;
    }
  };
};
function pl_default() {
  return {
    localeError: error35()
  };
}

// node_modules/zod/v4/locales/pt.js
var error36 = () => {
  const Sizable = {
    string: { unit: "caracteres", verb: "ter" },
    file: { unit: "bytes", verb: "ter" },
    array: { unit: "itens", verb: "ter" },
    set: { unit: "itens", verb: "ter" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "padrão",
    email: "endereço de e-mail",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data e hora ISO",
    date: "data ISO",
    time: "hora ISO",
    duration: "duração ISO",
    ipv4: "endereço IPv4",
    ipv6: "endereço IPv6",
    cidrv4: "faixa de IPv4",
    cidrv6: "faixa de IPv6",
    base64: "texto codificado em base64",
    base64url: "URL codificada em base64",
    json_string: "texto JSON",
    e164: "número E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "número",
    null: "nulo"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Tipo inválido: esperado instanceof ${issue2.expected}, recebido ${received}`;
        }
        return `Tipo inválido: esperado ${expected}, recebido ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrada inválida: esperado ${stringifyPrimitive(issue2.values[0])}`;
        return `Opção inválida: esperada uma das ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Muito grande: esperado que ${issue2.origin ?? "valor"} tivesse ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementos"}`;
        return `Muito grande: esperado que ${issue2.origin ?? "valor"} fosse ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Muito pequeno: esperado que ${issue2.origin} tivesse ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Muito pequeno: esperado que ${issue2.origin} fosse ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Texto inválido: deve começar com "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Texto inválido: deve terminar com "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Texto inválido: deve incluir "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Texto inválido: deve corresponder ao padrão ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} inválido`;
      }
      case "not_multiple_of":
        return `Número inválido: deve ser múltiplo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Chave${issue2.keys.length > 1 ? "s" : ""} desconhecida${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Chave inválida em ${issue2.origin}`;
      case "invalid_union":
        return "Entrada inválida";
      case "invalid_element":
        return `Valor inválido em ${issue2.origin}`;
      default:
        return `Campo inválido`;
    }
  };
};
function pt_default() {
  return {
    localeError: error36()
  };
}

// node_modules/zod/v4/locales/ro.js
var error37 = () => {
  const Sizable = {
    string: { unit: "caractere", verb: "să aibă" },
    file: { unit: "octeți", verb: "să aibă" },
    array: { unit: "elemente", verb: "să aibă" },
    set: { unit: "elemente", verb: "să aibă" },
    map: { unit: "intrări", verb: "să aibă" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "intrare",
    email: "adresă de email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "dată și oră ISO",
    date: "dată ISO",
    time: "oră ISO",
    duration: "durată ISO",
    ipv4: "adresă IPv4",
    ipv6: "adresă IPv6",
    mac: "adresă MAC",
    cidrv4: "interval IPv4",
    cidrv6: "interval IPv6",
    base64: "șir codat base64",
    base64url: "șir codat base64url",
    json_string: "șir JSON",
    e164: "număr E.164",
    jwt: "JWT",
    template_literal: "intrare"
  };
  const TypeDictionary = {
    nan: "NaN",
    string: "șir",
    number: "număr",
    boolean: "boolean",
    function: "funcție",
    array: "matrice",
    object: "obiect",
    undefined: "nedefinit",
    symbol: "simbol",
    bigint: "număr mare",
    void: "void",
    never: "never",
    map: "hartă",
    set: "set"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        return `Intrare invalidă: așteptat ${expected}, primit ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Intrare invalidă: așteptat ${stringifyPrimitive(issue2.values[0])}`;
        return `Opțiune invalidă: așteptat una dintre ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Prea mare: așteptat ca ${issue2.origin ?? "valoarea"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemente"}`;
        return `Prea mare: așteptat ca ${issue2.origin ?? "valoarea"} să fie ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Prea mic: așteptat ca ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Prea mic: așteptat ca ${issue2.origin} să fie ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Șir invalid: trebuie să înceapă cu "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Șir invalid: trebuie să se termine cu "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Șir invalid: trebuie să includă "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Șir invalid: trebuie să se potrivească cu modelul ${_issue.pattern}`;
        return `Format invalid: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Număr invalid: trebuie să fie multiplu de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Chei nerecunoscute: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Cheie invalidă în ${issue2.origin}`;
      case "invalid_union":
        return "Intrare invalidă";
      case "invalid_element":
        return `Valoare invalidă în ${issue2.origin}`;
      default:
        return `Intrare invalidă`;
    }
  };
};
function ro_default() {
  return {
    localeError: error37()
  };
}

// node_modules/zod/v4/locales/ru.js
function getRussianPlural(count, one, few, many) {
  const absCount = Math.abs(count);
  const lastDigit = absCount % 10;
  const lastTwoDigits = absCount % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return many;
  }
  if (lastDigit === 1) {
    return one;
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return few;
  }
  return many;
}
var error38 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "символ",
        few: "символа",
        many: "символов"
      },
      verb: "иметь"
    },
    file: {
      unit: {
        one: "байт",
        few: "байта",
        many: "байт"
      },
      verb: "иметь"
    },
    array: {
      unit: {
        one: "элемент",
        few: "элемента",
        many: "элементов"
      },
      verb: "иметь"
    },
    set: {
      unit: {
        one: "элемент",
        few: "элемента",
        many: "элементов"
      },
      verb: "иметь"
    }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "ввод",
    email: "email адрес",
    url: "URL",
    emoji: "эмодзи",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO дата и время",
    date: "ISO дата",
    time: "ISO время",
    duration: "ISO длительность",
    ipv4: "IPv4 адрес",
    ipv6: "IPv6 адрес",
    cidrv4: "IPv4 диапазон",
    cidrv6: "IPv6 диапазон",
    base64: "строка в формате base64",
    base64url: "строка в формате base64url",
    json_string: "JSON строка",
    e164: "номер E.164",
    jwt: "JWT",
    template_literal: "ввод"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "число",
    array: "массив"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Неверный ввод: ожидалось instanceof ${issue2.expected}, получено ${received}`;
        }
        return `Неверный ввод: ожидалось ${expected}, получено ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Неверный ввод: ожидалось ${stringifyPrimitive(issue2.values[0])}`;
        return `Неверный вариант: ожидалось одно из ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const maxValue = Number(issue2.maximum);
          const unit = getRussianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `Слишком большое значение: ожидалось, что ${issue2.origin ?? "значение"} будет иметь ${adj}${issue2.maximum.toString()} ${unit}`;
        }
        return `Слишком большое значение: ожидалось, что ${issue2.origin ?? "значение"} будет ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const minValue = Number(issue2.minimum);
          const unit = getRussianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `Слишком маленькое значение: ожидалось, что ${issue2.origin} будет иметь ${adj}${issue2.minimum.toString()} ${unit}`;
        }
        return `Слишком маленькое значение: ожидалось, что ${issue2.origin} будет ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Неверная строка: должна начинаться с "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Неверная строка: должна заканчиваться на "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Неверная строка: должна содержать "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Неверная строка: должна соответствовать шаблону ${_issue.pattern}`;
        return `Неверный ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Неверное число: должно быть кратным ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Нераспознанн${issue2.keys.length > 1 ? "ые" : "ый"} ключ${issue2.keys.length > 1 ? "и" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Неверный ключ в ${issue2.origin}`;
      case "invalid_union":
        return "Неверные входные данные";
      case "invalid_element":
        return `Неверное значение в ${issue2.origin}`;
      default:
        return `Неверные входные данные`;
    }
  };
};
function ru_default() {
  return {
    localeError: error38()
  };
}

// node_modules/zod/v4/locales/sl.js
var error39 = () => {
  const Sizable = {
    string: { unit: "znakov", verb: "imeti" },
    file: { unit: "bajtov", verb: "imeti" },
    array: { unit: "elementov", verb: "imeti" },
    set: { unit: "elementov", verb: "imeti" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "vnos",
    email: "e-poštni naslov",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datum in čas",
    date: "ISO datum",
    time: "ISO čas",
    duration: "ISO trajanje",
    ipv4: "IPv4 naslov",
    ipv6: "IPv6 naslov",
    cidrv4: "obseg IPv4",
    cidrv6: "obseg IPv6",
    base64: "base64 kodiran niz",
    base64url: "base64url kodiran niz",
    json_string: "JSON niz",
    e164: "E.164 številka",
    jwt: "JWT",
    template_literal: "vnos"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "število",
    array: "tabela"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Neveljaven vnos: pričakovano instanceof ${issue2.expected}, prejeto ${received}`;
        }
        return `Neveljaven vnos: pričakovano ${expected}, prejeto ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Neveljaven vnos: pričakovano ${stringifyPrimitive(issue2.values[0])}`;
        return `Neveljavna možnost: pričakovano eno izmed ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Preveliko: pričakovano, da bo ${issue2.origin ?? "vrednost"} imelo ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementov"}`;
        return `Preveliko: pričakovano, da bo ${issue2.origin ?? "vrednost"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Premajhno: pričakovano, da bo ${issue2.origin} imelo ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Premajhno: pričakovano, da bo ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Neveljaven niz: mora se začeti z "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Neveljaven niz: mora se končati z "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Neveljaven niz: mora vsebovati "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Neveljaven niz: mora ustrezati vzorcu ${_issue.pattern}`;
        return `Neveljaven ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Neveljavno število: mora biti večkratnik ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Neprepoznan${issue2.keys.length > 1 ? "i ključi" : " ključ"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Neveljaven ključ v ${issue2.origin}`;
      case "invalid_union":
        return "Neveljaven vnos";
      case "invalid_element":
        return `Neveljavna vrednost v ${issue2.origin}`;
      default:
        return "Neveljaven vnos";
    }
  };
};
function sl_default() {
  return {
    localeError: error39()
  };
}

// node_modules/zod/v4/locales/sv.js
var error40 = () => {
  const Sizable = {
    string: { unit: "tecken", verb: "att ha" },
    file: { unit: "bytes", verb: "att ha" },
    array: { unit: "objekt", verb: "att innehålla" },
    set: { unit: "objekt", verb: "att innehålla" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "reguljärt uttryck",
    email: "e-postadress",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-datum och tid",
    date: "ISO-datum",
    time: "ISO-tid",
    duration: "ISO-varaktighet",
    ipv4: "IPv4-intervall",
    ipv6: "IPv6-intervall",
    cidrv4: "IPv4-spektrum",
    cidrv6: "IPv6-spektrum",
    base64: "base64-kodad sträng",
    base64url: "base64url-kodad sträng",
    json_string: "JSON-sträng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "mall-literal"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "antal",
    array: "lista"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ogiltig inmatning: förväntat instanceof ${issue2.expected}, fick ${received}`;
        }
        return `Ogiltig inmatning: förväntat ${expected}, fick ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ogiltig inmatning: förväntat ${stringifyPrimitive(issue2.values[0])}`;
        return `Ogiltigt val: förväntade en av ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `För stor(t): förväntade ${issue2.origin ?? "värdet"} att ha ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "element"}`;
        }
        return `För stor(t): förväntat ${issue2.origin ?? "värdet"} att ha ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `För lite(t): förväntade ${issue2.origin ?? "värdet"} att ha ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `För lite(t): förväntade ${issue2.origin ?? "värdet"} att ha ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Ogiltig sträng: måste börja med "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Ogiltig sträng: måste sluta med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ogiltig sträng: måste innehålla "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ogiltig sträng: måste matcha mönstret "${_issue.pattern}"`;
        return `Ogiltig(t) ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ogiltigt tal: måste vara en multipel av ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Okända nycklar" : "Okänd nyckel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ogiltig nyckel i ${issue2.origin ?? "värdet"}`;
      case "invalid_union":
        return "Ogiltig input";
      case "invalid_element":
        return `Ogiltigt värde i ${issue2.origin ?? "värdet"}`;
      default:
        return `Ogiltig input`;
    }
  };
};
function sv_default() {
  return {
    localeError: error40()
  };
}

// node_modules/zod/v4/locales/ta.js
var error41 = () => {
  const Sizable = {
    string: { unit: "எழுத்துக்கள்", verb: "கொண்டிருக்க வேண்டும்" },
    file: { unit: "பைட்டுகள்", verb: "கொண்டிருக்க வேண்டும்" },
    array: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" },
    set: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "உள்ளீடு",
    email: "மின்னஞ்சல் முகவரி",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO தேதி நேரம்",
    date: "ISO தேதி",
    time: "ISO நேரம்",
    duration: "ISO கால அளவு",
    ipv4: "IPv4 முகவரி",
    ipv6: "IPv6 முகவரி",
    cidrv4: "IPv4 வரம்பு",
    cidrv6: "IPv6 வரம்பு",
    base64: "base64-encoded சரம்",
    base64url: "base64url-encoded சரம்",
    json_string: "JSON சரம்",
    e164: "E.164 எண்",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "எண்",
    array: "அணி",
    null: "வெறுமை"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது instanceof ${issue2.expected}, பெறப்பட்டது ${received}`;
        }
        return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது ${expected}, பெறப்பட்டது ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது ${stringifyPrimitive(issue2.values[0])}`;
        return `தவறான விருப்பம்: எதிர்பார்க்கப்பட்டது ${joinValues(issue2.values, "|")} இல் ஒன்று`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `மிக பெரியது: எதிர்பார்க்கப்பட்டது ${issue2.origin ?? "மதிப்பு"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "உறுப்புகள்"} ஆக இருக்க வேண்டும்`;
        }
        return `மிக பெரியது: எதிர்பார்க்கப்பட்டது ${issue2.origin ?? "மதிப்பு"} ${adj}${issue2.maximum.toString()} ஆக இருக்க வேண்டும்`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `மிகச் சிறியது: எதிர்பார்க்கப்பட்டது ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} ஆக இருக்க வேண்டும்`;
        }
        return `மிகச் சிறியது: எதிர்பார்க்கப்பட்டது ${issue2.origin} ${adj}${issue2.minimum.toString()} ஆக இருக்க வேண்டும்`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `தவறான சரம்: "${_issue.prefix}" இல் தொடங்க வேண்டும்`;
        if (_issue.format === "ends_with")
          return `தவறான சரம்: "${_issue.suffix}" இல் முடிவடைய வேண்டும்`;
        if (_issue.format === "includes")
          return `தவறான சரம்: "${_issue.includes}" ஐ உள்ளடக்க வேண்டும்`;
        if (_issue.format === "regex")
          return `தவறான சரம்: ${_issue.pattern} முறைபாட்டுடன் பொருந்த வேண்டும்`;
        return `தவறான ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `தவறான எண்: ${issue2.divisor} இன் பலமாக இருக்க வேண்டும்`;
      case "unrecognized_keys":
        return `அடையாளம் தெரியாத விசை${issue2.keys.length > 1 ? "கள்" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} இல் தவறான விசை`;
      case "invalid_union":
        return "தவறான உள்ளீடு";
      case "invalid_element":
        return `${issue2.origin} இல் தவறான மதிப்பு`;
      default:
        return `தவறான உள்ளீடு`;
    }
  };
};
function ta_default() {
  return {
    localeError: error41()
  };
}

// node_modules/zod/v4/locales/th.js
var error42 = () => {
  const Sizable = {
    string: { unit: "ตัวอักษร", verb: "ควรมี" },
    file: { unit: "ไบต์", verb: "ควรมี" },
    array: { unit: "รายการ", verb: "ควรมี" },
    set: { unit: "รายการ", verb: "ควรมี" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "ข้อมูลที่ป้อน",
    email: "ที่อยู่อีเมล",
    url: "URL",
    emoji: "อิโมจิ",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "วันที่เวลาแบบ ISO",
    date: "วันที่แบบ ISO",
    time: "เวลาแบบ ISO",
    duration: "ช่วงเวลาแบบ ISO",
    ipv4: "ที่อยู่ IPv4",
    ipv6: "ที่อยู่ IPv6",
    cidrv4: "ช่วง IP แบบ IPv4",
    cidrv6: "ช่วง IP แบบ IPv6",
    base64: "ข้อความแบบ Base64",
    base64url: "ข้อความแบบ Base64 สำหรับ URL",
    json_string: "ข้อความแบบ JSON",
    e164: "เบอร์โทรศัพท์ระหว่างประเทศ (E.164)",
    jwt: "โทเคน JWT",
    template_literal: "ข้อมูลที่ป้อน"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "ตัวเลข",
    array: "อาร์เรย์ (Array)",
    null: "ไม่มีค่า (null)"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `ประเภทข้อมูลไม่ถูกต้อง: ควรเป็น instanceof ${issue2.expected} แต่ได้รับ ${received}`;
        }
        return `ประเภทข้อมูลไม่ถูกต้อง: ควรเป็น ${expected} แต่ได้รับ ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `ค่าไม่ถูกต้อง: ควรเป็น ${stringifyPrimitive(issue2.values[0])}`;
        return `ตัวเลือกไม่ถูกต้อง: ควรเป็นหนึ่งใน ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "ไม่เกิน" : "น้อยกว่า";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `เกินกำหนด: ${issue2.origin ?? "ค่า"} ควรมี${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "รายการ"}`;
        return `เกินกำหนด: ${issue2.origin ?? "ค่า"} ควรมี${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "อย่างน้อย" : "มากกว่า";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `น้อยกว่ากำหนด: ${issue2.origin} ควรมี${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `น้อยกว่ากำหนด: ${issue2.origin} ควรมี${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `รูปแบบไม่ถูกต้อง: ข้อความต้องขึ้นต้นด้วย "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `รูปแบบไม่ถูกต้อง: ข้อความต้องลงท้ายด้วย "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `รูปแบบไม่ถูกต้อง: ข้อความต้องมี "${_issue.includes}" อยู่ในข้อความ`;
        if (_issue.format === "regex")
          return `รูปแบบไม่ถูกต้อง: ต้องตรงกับรูปแบบที่กำหนด ${_issue.pattern}`;
        return `รูปแบบไม่ถูกต้อง: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `ตัวเลขไม่ถูกต้อง: ต้องเป็นจำนวนที่หารด้วย ${issue2.divisor} ได้ลงตัว`;
      case "unrecognized_keys":
        return `พบคีย์ที่ไม่รู้จัก: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `คีย์ไม่ถูกต้องใน ${issue2.origin}`;
      case "invalid_union":
        return "ข้อมูลไม่ถูกต้อง: ไม่ตรงกับรูปแบบยูเนียนที่กำหนดไว้";
      case "invalid_element":
        return `ข้อมูลไม่ถูกต้องใน ${issue2.origin}`;
      default:
        return `ข้อมูลไม่ถูกต้อง`;
    }
  };
};
function th_default() {
  return {
    localeError: error42()
  };
}

// node_modules/zod/v4/locales/tr.js
var error43 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "olmalı" },
    file: { unit: "bayt", verb: "olmalı" },
    array: { unit: "öğe", verb: "olmalı" },
    set: { unit: "öğe", verb: "olmalı" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "girdi",
    email: "e-posta adresi",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO tarih ve saat",
    date: "ISO tarih",
    time: "ISO saat",
    duration: "ISO süre",
    ipv4: "IPv4 adresi",
    ipv6: "IPv6 adresi",
    cidrv4: "IPv4 aralığı",
    cidrv6: "IPv6 aralığı",
    base64: "base64 ile şifrelenmiş metin",
    base64url: "base64url ile şifrelenmiş metin",
    json_string: "JSON dizesi",
    e164: "E.164 sayısı",
    jwt: "JWT",
    template_literal: "Şablon dizesi"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Geçersiz değer: beklenen instanceof ${issue2.expected}, alınan ${received}`;
        }
        return `Geçersiz değer: beklenen ${expected}, alınan ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Geçersiz değer: beklenen ${stringifyPrimitive(issue2.values[0])}`;
        return `Geçersiz seçenek: aşağıdakilerden biri olmalı: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Çok büyük: beklenen ${issue2.origin ?? "değer"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "öğe"}`;
        return `Çok büyük: beklenen ${issue2.origin ?? "değer"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Çok küçük: beklenen ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        return `Çok küçük: beklenen ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Geçersiz metin: "${_issue.prefix}" ile başlamalı`;
        if (_issue.format === "ends_with")
          return `Geçersiz metin: "${_issue.suffix}" ile bitmeli`;
        if (_issue.format === "includes")
          return `Geçersiz metin: "${_issue.includes}" içermeli`;
        if (_issue.format === "regex")
          return `Geçersiz metin: ${_issue.pattern} desenine uymalı`;
        return `Geçersiz ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Geçersiz sayı: ${issue2.divisor} ile tam bölünebilmeli`;
      case "unrecognized_keys":
        return `Tanınmayan anahtar${issue2.keys.length > 1 ? "lar" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} içinde geçersiz anahtar`;
      case "invalid_union":
        return "Geçersiz değer";
      case "invalid_element":
        return `${issue2.origin} içinde geçersiz değer`;
      default:
        return `Geçersiz değer`;
    }
  };
};
function tr_default() {
  return {
    localeError: error43()
  };
}

// node_modules/zod/v4/locales/uk.js
var error44 = () => {
  const Sizable = {
    string: { unit: "символів", verb: "матиме" },
    file: { unit: "байтів", verb: "матиме" },
    array: { unit: "елементів", verb: "матиме" },
    set: { unit: "елементів", verb: "матиме" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "вхідні дані",
    email: "адреса електронної пошти",
    url: "URL",
    emoji: "емодзі",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "дата та час ISO",
    date: "дата ISO",
    time: "час ISO",
    duration: "тривалість ISO",
    ipv4: "адреса IPv4",
    ipv6: "адреса IPv6",
    cidrv4: "діапазон IPv4",
    cidrv6: "діапазон IPv6",
    base64: "рядок у кодуванні base64",
    base64url: "рядок у кодуванні base64url",
    json_string: "рядок JSON",
    e164: "номер E.164",
    jwt: "JWT",
    template_literal: "вхідні дані"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "число",
    array: "масив"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Неправильні вхідні дані: очікується instanceof ${issue2.expected}, отримано ${received}`;
        }
        return `Неправильні вхідні дані: очікується ${expected}, отримано ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Неправильні вхідні дані: очікується ${stringifyPrimitive(issue2.values[0])}`;
        return `Неправильна опція: очікується одне з ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Занадто велике: очікується, що ${issue2.origin ?? "значення"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "елементів"}`;
        return `Занадто велике: очікується, що ${issue2.origin ?? "значення"} буде ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Занадто мале: очікується, що ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Занадто мале: очікується, що ${issue2.origin} буде ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Неправильний рядок: повинен починатися з "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Неправильний рядок: повинен закінчуватися на "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Неправильний рядок: повинен містити "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Неправильний рядок: повинен відповідати шаблону ${_issue.pattern}`;
        return `Неправильний ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Неправильне число: повинно бути кратним ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Нерозпізнаний ключ${issue2.keys.length > 1 ? "і" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Неправильний ключ у ${issue2.origin}`;
      case "invalid_union":
        return "Неправильні вхідні дані";
      case "invalid_element":
        return `Неправильне значення у ${issue2.origin}`;
      default:
        return `Неправильні вхідні дані`;
    }
  };
};
function uk_default() {
  return {
    localeError: error44()
  };
}

// node_modules/zod/v4/locales/ua.js
function ua_default() {
  return uk_default();
}

// node_modules/zod/v4/locales/ur.js
var error45 = () => {
  const Sizable = {
    string: { unit: "حروف", verb: "ہونا" },
    file: { unit: "بائٹس", verb: "ہونا" },
    array: { unit: "آئٹمز", verb: "ہونا" },
    set: { unit: "آئٹمز", verb: "ہونا" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "ان پٹ",
    email: "ای میل ایڈریس",
    url: "یو آر ایل",
    emoji: "ایموجی",
    uuid: "یو یو آئی ڈی",
    uuidv4: "یو یو آئی ڈی وی 4",
    uuidv6: "یو یو آئی ڈی وی 6",
    nanoid: "نینو آئی ڈی",
    guid: "جی یو آئی ڈی",
    cuid: "سی یو آئی ڈی",
    cuid2: "سی یو آئی ڈی 2",
    ulid: "یو ایل آئی ڈی",
    xid: "ایکس آئی ڈی",
    ksuid: "کے ایس یو آئی ڈی",
    datetime: "آئی ایس او ڈیٹ ٹائم",
    date: "آئی ایس او تاریخ",
    time: "آئی ایس او وقت",
    duration: "آئی ایس او مدت",
    ipv4: "آئی پی وی 4 ایڈریس",
    ipv6: "آئی پی وی 6 ایڈریس",
    cidrv4: "آئی پی وی 4 رینج",
    cidrv6: "آئی پی وی 6 رینج",
    base64: "بیس 64 ان کوڈڈ سٹرنگ",
    base64url: "بیس 64 یو آر ایل ان کوڈڈ سٹرنگ",
    json_string: "جے ایس او این سٹرنگ",
    e164: "ای 164 نمبر",
    jwt: "جے ڈبلیو ٹی",
    template_literal: "ان پٹ"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "نمبر",
    array: "آرے",
    null: "نل"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `غلط ان پٹ: instanceof ${issue2.expected} متوقع تھا، ${received} موصول ہوا`;
        }
        return `غلط ان پٹ: ${expected} متوقع تھا، ${received} موصول ہوا`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `غلط ان پٹ: ${stringifyPrimitive(issue2.values[0])} متوقع تھا`;
        return `غلط آپشن: ${joinValues(issue2.values, "|")} میں سے ایک متوقع تھا`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `بہت بڑا: ${issue2.origin ?? "ویلیو"} کے ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "عناصر"} ہونے متوقع تھے`;
        return `بہت بڑا: ${issue2.origin ?? "ویلیو"} کا ${adj}${issue2.maximum.toString()} ہونا متوقع تھا`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `بہت چھوٹا: ${issue2.origin} کے ${adj}${issue2.minimum.toString()} ${sizing.unit} ہونے متوقع تھے`;
        }
        return `بہت چھوٹا: ${issue2.origin} کا ${adj}${issue2.minimum.toString()} ہونا متوقع تھا`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `غلط سٹرنگ: "${_issue.prefix}" سے شروع ہونا چاہیے`;
        }
        if (_issue.format === "ends_with")
          return `غلط سٹرنگ: "${_issue.suffix}" پر ختم ہونا چاہیے`;
        if (_issue.format === "includes")
          return `غلط سٹرنگ: "${_issue.includes}" شامل ہونا چاہیے`;
        if (_issue.format === "regex")
          return `غلط سٹرنگ: پیٹرن ${_issue.pattern} سے میچ ہونا چاہیے`;
        return `غلط ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `غلط نمبر: ${issue2.divisor} کا مضاعف ہونا چاہیے`;
      case "unrecognized_keys":
        return `غیر تسلیم شدہ کی${issue2.keys.length > 1 ? "ز" : ""}: ${joinValues(issue2.keys, "، ")}`;
      case "invalid_key":
        return `${issue2.origin} میں غلط کی`;
      case "invalid_union":
        return "غلط ان پٹ";
      case "invalid_element":
        return `${issue2.origin} میں غلط ویلیو`;
      default:
        return `غلط ان پٹ`;
    }
  };
};
function ur_default() {
  return {
    localeError: error45()
  };
}

// node_modules/zod/v4/locales/uz.js
var error46 = () => {
  const Sizable = {
    string: { unit: "belgi", verb: "bo‘lishi kerak" },
    file: { unit: "bayt", verb: "bo‘lishi kerak" },
    array: { unit: "element", verb: "bo‘lishi kerak" },
    set: { unit: "element", verb: "bo‘lishi kerak" },
    map: { unit: "yozuv", verb: "bo‘lishi kerak" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "kirish",
    email: "elektron pochta manzili",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO sana va vaqti",
    date: "ISO sana",
    time: "ISO vaqt",
    duration: "ISO davomiylik",
    ipv4: "IPv4 manzil",
    ipv6: "IPv6 manzil",
    mac: "MAC manzil",
    cidrv4: "IPv4 diapazon",
    cidrv6: "IPv6 diapazon",
    base64: "base64 kodlangan satr",
    base64url: "base64url kodlangan satr",
    json_string: "JSON satr",
    e164: "E.164 raqam",
    jwt: "JWT",
    template_literal: "kirish"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "raqam",
    array: "massiv"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Noto‘g‘ri kirish: kutilgan instanceof ${issue2.expected}, qabul qilingan ${received}`;
        }
        return `Noto‘g‘ri kirish: kutilgan ${expected}, qabul qilingan ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Noto‘g‘ri kirish: kutilgan ${stringifyPrimitive(issue2.values[0])}`;
        return `Noto‘g‘ri variant: quyidagilardan biri kutilgan ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Juda katta: kutilgan ${issue2.origin ?? "qiymat"} ${adj}${issue2.maximum.toString()} ${sizing.unit} ${sizing.verb}`;
        return `Juda katta: kutilgan ${issue2.origin ?? "qiymat"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Juda kichik: kutilgan ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
        }
        return `Juda kichik: kutilgan ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Noto‘g‘ri satr: "${_issue.prefix}" bilan boshlanishi kerak`;
        if (_issue.format === "ends_with")
          return `Noto‘g‘ri satr: "${_issue.suffix}" bilan tugashi kerak`;
        if (_issue.format === "includes")
          return `Noto‘g‘ri satr: "${_issue.includes}" ni o‘z ichiga olishi kerak`;
        if (_issue.format === "regex")
          return `Noto‘g‘ri satr: ${_issue.pattern} shabloniga mos kelishi kerak`;
        return `Noto‘g‘ri ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Noto‘g‘ri raqam: ${issue2.divisor} ning karralisi bo‘lishi kerak`;
      case "unrecognized_keys":
        return `Noma’lum kalit${issue2.keys.length > 1 ? "lar" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} dagi kalit noto‘g‘ri`;
      case "invalid_union":
        return "Noto‘g‘ri kirish";
      case "invalid_element":
        return `${issue2.origin} da noto‘g‘ri qiymat`;
      default:
        return `Noto‘g‘ri kirish`;
    }
  };
};
function uz_default() {
  return {
    localeError: error46()
  };
}

// node_modules/zod/v4/locales/vi.js
var error47 = () => {
  const Sizable = {
    string: { unit: "ký tự", verb: "có" },
    file: { unit: "byte", verb: "có" },
    array: { unit: "phần tử", verb: "có" },
    set: { unit: "phần tử", verb: "có" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "đầu vào",
    email: "địa chỉ email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ngày giờ ISO",
    date: "ngày ISO",
    time: "giờ ISO",
    duration: "khoảng thời gian ISO",
    ipv4: "địa chỉ IPv4",
    ipv6: "địa chỉ IPv6",
    cidrv4: "dải IPv4",
    cidrv6: "dải IPv6",
    base64: "chuỗi mã hóa base64",
    base64url: "chuỗi mã hóa base64url",
    json_string: "chuỗi JSON",
    e164: "số E.164",
    jwt: "JWT",
    template_literal: "đầu vào"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "số",
    array: "mảng"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Đầu vào không hợp lệ: mong đợi instanceof ${issue2.expected}, nhận được ${received}`;
        }
        return `Đầu vào không hợp lệ: mong đợi ${expected}, nhận được ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Đầu vào không hợp lệ: mong đợi ${stringifyPrimitive(issue2.values[0])}`;
        return `Tùy chọn không hợp lệ: mong đợi một trong các giá trị ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Quá lớn: mong đợi ${issue2.origin ?? "giá trị"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "phần tử"}`;
        return `Quá lớn: mong đợi ${issue2.origin ?? "giá trị"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Quá nhỏ: mong đợi ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Quá nhỏ: mong đợi ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Chuỗi không hợp lệ: phải bắt đầu bằng "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Chuỗi không hợp lệ: phải kết thúc bằng "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Chuỗi không hợp lệ: phải bao gồm "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Chuỗi không hợp lệ: phải khớp với mẫu ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} không hợp lệ`;
      }
      case "not_multiple_of":
        return `Số không hợp lệ: phải là bội số của ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Khóa không được nhận dạng: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Khóa không hợp lệ trong ${issue2.origin}`;
      case "invalid_union":
        return "Đầu vào không hợp lệ";
      case "invalid_element":
        return `Giá trị không hợp lệ trong ${issue2.origin}`;
      default:
        return `Đầu vào không hợp lệ`;
    }
  };
};
function vi_default() {
  return {
    localeError: error47()
  };
}

// node_modules/zod/v4/locales/zh-CN.js
var error48 = () => {
  const Sizable = {
    string: { unit: "字符", verb: "包含" },
    file: { unit: "字节", verb: "包含" },
    array: { unit: "项", verb: "包含" },
    set: { unit: "项", verb: "包含" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "输入",
    email: "电子邮件",
    url: "URL",
    emoji: "表情符号",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO日期时间",
    date: "ISO日期",
    time: "ISO时间",
    duration: "ISO时长",
    ipv4: "IPv4地址",
    ipv6: "IPv6地址",
    cidrv4: "IPv4网段",
    cidrv6: "IPv6网段",
    base64: "base64编码字符串",
    base64url: "base64url编码字符串",
    json_string: "JSON字符串",
    e164: "E.164号码",
    jwt: "JWT",
    template_literal: "输入"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "数字",
    array: "数组",
    null: "空值(null)"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `无效输入：期望 instanceof ${issue2.expected}，实际接收 ${received}`;
        }
        return `无效输入：期望 ${expected}，实际接收 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `无效输入：期望 ${stringifyPrimitive(issue2.values[0])}`;
        return `无效选项：期望以下之一 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `数值过大：期望 ${issue2.origin ?? "值"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "个元素"}`;
        return `数值过大：期望 ${issue2.origin ?? "值"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `数值过小：期望 ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `数值过小：期望 ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `无效字符串：必须以 "${_issue.prefix}" 开头`;
        if (_issue.format === "ends_with")
          return `无效字符串：必须以 "${_issue.suffix}" 结尾`;
        if (_issue.format === "includes")
          return `无效字符串：必须包含 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `无效字符串：必须满足正则表达式 ${_issue.pattern}`;
        return `无效${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `无效数字：必须是 ${issue2.divisor} 的倍数`;
      case "unrecognized_keys":
        return `出现未知的键(key): ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} 中的键(key)无效`;
      case "invalid_union":
        return "无效输入";
      case "invalid_element":
        return `${issue2.origin} 中包含无效值(value)`;
      default:
        return `无效输入`;
    }
  };
};
function zh_CN_default() {
  return {
    localeError: error48()
  };
}

// node_modules/zod/v4/locales/zh-TW.js
var error49 = () => {
  const Sizable = {
    string: { unit: "字元", verb: "擁有" },
    file: { unit: "位元組", verb: "擁有" },
    array: { unit: "項目", verb: "擁有" },
    set: { unit: "項目", verb: "擁有" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "輸入",
    email: "郵件地址",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO 日期時間",
    date: "ISO 日期",
    time: "ISO 時間",
    duration: "ISO 期間",
    ipv4: "IPv4 位址",
    ipv6: "IPv6 位址",
    cidrv4: "IPv4 範圍",
    cidrv6: "IPv6 範圍",
    base64: "base64 編碼字串",
    base64url: "base64url 編碼字串",
    json_string: "JSON 字串",
    e164: "E.164 數值",
    jwt: "JWT",
    template_literal: "輸入"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `無效的輸入值：預期為 instanceof ${issue2.expected}，但收到 ${received}`;
        }
        return `無效的輸入值：預期為 ${expected}，但收到 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `無效的輸入值：預期為 ${stringifyPrimitive(issue2.values[0])}`;
        return `無效的選項：預期為以下其中之一 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `數值過大：預期 ${issue2.origin ?? "值"} 應為 ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "個元素"}`;
        return `數值過大：預期 ${issue2.origin ?? "值"} 應為 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `數值過小：預期 ${issue2.origin} 應為 ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `數值過小：預期 ${issue2.origin} 應為 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `無效的字串：必須以 "${_issue.prefix}" 開頭`;
        }
        if (_issue.format === "ends_with")
          return `無效的字串：必須以 "${_issue.suffix}" 結尾`;
        if (_issue.format === "includes")
          return `無效的字串：必須包含 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `無效的字串：必須符合格式 ${_issue.pattern}`;
        return `無效的 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `無效的數字：必須為 ${issue2.divisor} 的倍數`;
      case "unrecognized_keys":
        return `無法識別的鍵值${issue2.keys.length > 1 ? "們" : ""}：${joinValues(issue2.keys, "、")}`;
      case "invalid_key":
        return `${issue2.origin} 中有無效的鍵值`;
      case "invalid_union":
        return "無效的輸入值";
      case "invalid_element":
        return `${issue2.origin} 中有無效的值`;
      default:
        return `無效的輸入值`;
    }
  };
};
function zh_TW_default() {
  return {
    localeError: error49()
  };
}

// node_modules/zod/v4/locales/yo.js
var error50 = () => {
  const Sizable = {
    string: { unit: "àmi", verb: "ní" },
    file: { unit: "bytes", verb: "ní" },
    array: { unit: "nkan", verb: "ní" },
    set: { unit: "nkan", verb: "ní" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "ẹ̀rọ ìbáwọlé",
    email: "àdírẹ́sì ìmẹ́lì",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "àkókò ISO",
    date: "ọjọ́ ISO",
    time: "àkókò ISO",
    duration: "àkókò tó pé ISO",
    ipv4: "àdírẹ́sì IPv4",
    ipv6: "àdírẹ́sì IPv6",
    cidrv4: "àgbègbè IPv4",
    cidrv6: "àgbègbè IPv6",
    base64: "ọ̀rọ̀ tí a kọ́ ní base64",
    base64url: "ọ̀rọ̀ base64url",
    json_string: "ọ̀rọ̀ JSON",
    e164: "nọ́mbà E.164",
    jwt: "JWT",
    template_literal: "ẹ̀rọ ìbáwọlé"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "nọ́mbà",
    array: "akopọ"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ìbáwọlé aṣìṣe: a ní láti fi instanceof ${issue2.expected}, àmọ̀ a rí ${received}`;
        }
        return `Ìbáwọlé aṣìṣe: a ní láti fi ${expected}, àmọ̀ a rí ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ìbáwọlé aṣìṣe: a ní láti fi ${stringifyPrimitive(issue2.values[0])}`;
        return `Àṣàyàn aṣìṣe: yan ọ̀kan lára ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Tó pọ̀ jù: a ní láti jẹ́ pé ${issue2.origin ?? "iye"} ${sizing.verb} ${adj}${issue2.maximum} ${sizing.unit}`;
        return `Tó pọ̀ jù: a ní láti jẹ́ ${adj}${issue2.maximum}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Kéré ju: a ní láti jẹ́ pé ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum} ${sizing.unit}`;
        return `Kéré ju: a ní láti jẹ́ ${adj}${issue2.minimum}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ bẹ̀rẹ̀ pẹ̀lú "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ parí pẹ̀lú "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ ní "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ bá àpẹẹrẹ mu ${_issue.pattern}`;
        return `Aṣìṣe: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Nọ́mbà aṣìṣe: gbọ́dọ̀ jẹ́ èyà pípín ti ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Bọtìnì àìmọ̀: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Bọtìnì aṣìṣe nínú ${issue2.origin}`;
      case "invalid_union":
        return "Ìbáwọlé aṣìṣe";
      case "invalid_element":
        return `Iye aṣìṣe nínú ${issue2.origin}`;
      default:
        return "Ìbáwọlé aṣìṣe";
    }
  };
};
function yo_default() {
  return {
    localeError: error50()
  };
}

// node_modules/zod/v4/core/registries.js
var _a2;
var $output = /* @__PURE__ */ Symbol("ZodOutput");
var $input = /* @__PURE__ */ Symbol("ZodInput");
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta3 = _meta[0];
    this._map.set(schema, meta3);
    if (meta3 && typeof meta3 === "object" && "id" in meta3) {
      this._idmap.set(meta3.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta3 = this._map.get(schema);
    if (meta3 && typeof meta3 === "object" && "id" in meta3) {
      this._idmap.delete(meta3.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f2 = { ...pm, ...this._map.get(schema) };
      return Object.keys(f2).length ? f2 : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;

// node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedString(Class2, params) {
  return new Class2({
    type: "string",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _mac(Class2, params) {
  return new Class2({
    type: "string",
    format: "mac",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
var TimePrecision = {
  Any: null,
  Minute: -1,
  Second: 0,
  Millisecond: 3,
  Microsecond: 6
};
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedNumber(Class2, params) {
  return new Class2({
    type: "number",
    coerce: true,
    checks: [],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _float32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _float64(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "int32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uint32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "uint32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedBoolean(Class2, params) {
  return new Class2({
    type: "boolean",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _bigint(Class2, params) {
  return new Class2({
    type: "bigint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedBigint(Class2, params) {
  return new Class2({
    type: "bigint",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int64(Class2, params) {
  return new Class2({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "int64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uint64(Class2, params) {
  return new Class2({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "uint64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _symbol(Class2, params) {
  return new Class2({
    type: "symbol",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _undefined2(Class2, params) {
  return new Class2({
    type: "undefined",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _null2(Class2, params) {
  return new Class2({
    type: "null",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _any(Class2) {
  return new Class2({
    type: "any"
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _void(Class2, params) {
  return new Class2({
    type: "void",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _date(Class2, params) {
  return new Class2({
    type: "date",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedDate(Class2, params) {
  return new Class2({
    type: "date",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nan(Class2, params) {
  return new Class2({
    type: "nan",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _positive(params) {
  return /* @__PURE__ */ _gt(0, params);
}
// @__NO_SIDE_EFFECTS__
function _negative(params) {
  return /* @__PURE__ */ _lt(0, params);
}
// @__NO_SIDE_EFFECTS__
function _nonpositive(params) {
  return /* @__PURE__ */ _lte(0, params);
}
// @__NO_SIDE_EFFECTS__
function _nonnegative(params) {
  return /* @__PURE__ */ _gte(0, params);
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxSize(maximum, params) {
  return new $ZodCheckMaxSize({
    check: "max_size",
    ...normalizeParams(params),
    maximum
  });
}
// @__NO_SIDE_EFFECTS__
function _minSize(minimum, params) {
  return new $ZodCheckMinSize({
    check: "min_size",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _size(size, params) {
  return new $ZodCheckSizeEquals({
    check: "size_equals",
    ...normalizeParams(params),
    size
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _property(property, schema, params) {
  return new $ZodCheckProperty({
    check: "property",
    property,
    schema,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _mime(types2, params) {
  return new $ZodCheckMimeType({
    check: "mime_type",
    mime: types2,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _union(Class2, options, params) {
  return new Class2({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
function _xor(Class2, options, params) {
  return new Class2({
    type: "union",
    options,
    inclusive: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _discriminatedUnion(Class2, discriminator, options, params) {
  return new Class2({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _intersection(Class2, left, right) {
  return new Class2({
    type: "intersection",
    left,
    right
  });
}
// @__NO_SIDE_EFFECTS__
function _tuple(Class2, items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new Class2({
    type: "tuple",
    items,
    rest,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _record(Class2, keyType, valueType, params) {
  return new Class2({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _map(Class2, keyType, valueType, params) {
  return new Class2({
    type: "map",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _set(Class2, valueType, params) {
  return new Class2({
    type: "set",
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _enum(Class2, values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new Class2({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nativeEnum(Class2, entries, params) {
  return new Class2({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _literal(Class2, value, params) {
  return new Class2({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _file(Class2, params) {
  return new Class2({
    type: "file",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _transform(Class2, fn) {
  return new Class2({
    type: "transform",
    transform: fn
  });
}
// @__NO_SIDE_EFFECTS__
function _optional(Class2, innerType) {
  return new Class2({
    type: "optional",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _nullable(Class2, innerType) {
  return new Class2({
    type: "nullable",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _default(Class2, innerType, defaultValue) {
  return new Class2({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
// @__NO_SIDE_EFFECTS__
function _nonoptional(Class2, innerType, params) {
  return new Class2({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _success(Class2, innerType) {
  return new Class2({
    type: "success",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _catch(Class2, innerType, catchValue) {
  return new Class2({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
// @__NO_SIDE_EFFECTS__
function _pipe(Class2, in_, out) {
  return new Class2({
    type: "pipe",
    in: in_,
    out
  });
}
// @__NO_SIDE_EFFECTS__
function _readonly(Class2, innerType) {
  return new Class2({
    type: "readonly",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _templateLiteral(Class2, parts, params) {
  return new Class2({
    type: "template_literal",
    parts,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lazy(Class2, getter) {
  return new Class2({
    type: "lazy",
    getter
  });
}
// @__NO_SIDE_EFFECTS__
function _promise(Class2, innerType) {
  return new Class2({
    type: "promise",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _custom(Class2, fn, _params) {
  const norm = normalizeParams(_params);
  norm.abort ?? (norm.abort = true);
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...norm
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// @__NO_SIDE_EFFECTS__
function describe(description) {
  const ch = new $ZodCheck({ check: "describe" });
  ch._zod.onattach = [
    (inst) => {
      const existing = globalRegistry.get(inst) ?? {};
      globalRegistry.add(inst, { ...existing, description });
    }
  ];
  ch._zod.check = () => {
  };
  return ch;
}
// @__NO_SIDE_EFFECTS__
function meta(metadata) {
  const ch = new $ZodCheck({ check: "meta" });
  ch._zod.onattach = [
    (inst) => {
      const existing = globalRegistry.get(inst) ?? {};
      globalRegistry.add(inst, { ...existing, ...metadata });
    }
  ];
  ch._zod.check = () => {
  };
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _stringbool(Classes, _params) {
  const params = normalizeParams(_params);
  let truthyArray = params.truthy ?? ["true", "1", "yes", "on", "y", "enabled"];
  let falsyArray = params.falsy ?? ["false", "0", "no", "off", "n", "disabled"];
  if (params.case !== "sensitive") {
    truthyArray = truthyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
    falsyArray = falsyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
  }
  const truthySet = new Set(truthyArray);
  const falsySet = new Set(falsyArray);
  const _Codec = Classes.Codec ?? $ZodCodec;
  const _Boolean = Classes.Boolean ?? $ZodBoolean;
  const _String = Classes.String ?? $ZodString;
  const stringSchema = new _String({ type: "string", error: params.error });
  const booleanSchema = new _Boolean({ type: "boolean", error: params.error });
  const codec2 = new _Codec({
    type: "pipe",
    in: stringSchema,
    out: booleanSchema,
    transform: ((input, payload) => {
      let data = input;
      if (params.case !== "sensitive")
        data = data.toLowerCase();
      if (truthySet.has(data)) {
        return true;
      } else if (falsySet.has(data)) {
        return false;
      } else {
        payload.issues.push({
          code: "invalid_value",
          expected: "stringbool",
          values: [...truthySet, ...falsySet],
          input: payload.value,
          inst: codec2,
          continue: false
        });
        return {};
      }
    }),
    reverseTransform: ((input, _payload) => {
      if (input === true) {
        return truthyArray[0] || "true";
      } else {
        return falsyArray[0] || "false";
      }
    }),
    error: params.error
  });
  return codec2;
}
// @__NO_SIDE_EFFECTS__
function _stringFormat(Class2, format, fnOrRegex, _params = {}) {
  const params = normalizeParams(_params);
  const def = {
    ...normalizeParams(_params),
    check: "string_format",
    type: "string",
    format,
    fn: typeof fnOrRegex === "function" ? fnOrRegex : (val) => fnOrRegex.test(val),
    ...params
  };
  if (fnOrRegex instanceof RegExp) {
    def.pattern = fnOrRegex;
  }
  const inst = new Class2(def);
  return inst;
}

// node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? void 0
  };
}
function process(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta3 = ctx.metadataRegistry.get(schema);
  if (meta3)
    Object.assign(result.schema, meta3);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        Object.assign(schema2, refSchema);
      }
      Object.assign(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId)
        delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};

// node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
var stringProcessor = (schema, ctx, _json, _params) => {
  const json2 = _json;
  json2.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number")
    json2.minLength = minimum;
  if (typeof maximum === "number")
    json2.maxLength = maximum;
  if (format) {
    json2.format = formatMap[format] ?? format;
    if (json2.format === "")
      delete json2.format;
    if (format === "time") {
      delete json2.format;
    }
  }
  if (contentEncoding)
    json2.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json2.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json2.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, _params) => {
  const json2 = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json2.type = "integer";
  else
    json2.type = "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json2.minimum = exclusiveMinimum;
      json2.exclusiveMinimum = true;
    } else {
      json2.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json2.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json2.maximum = exclusiveMaximum;
      json2.exclusiveMaximum = true;
    } else {
      json2.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json2.maximum = maximum;
  }
  if (typeof multipleOf === "number")
    json2.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json2, _params) => {
  json2.type = "boolean";
};
var bigintProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("BigInt cannot be represented in JSON Schema");
  }
};
var symbolProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Symbols cannot be represented in JSON Schema");
  }
};
var nullProcessor = (_schema, ctx, json2, _params) => {
  if (ctx.target === "openapi-3.0") {
    json2.type = "string";
    json2.nullable = true;
    json2.enum = [null];
  } else {
    json2.type = "null";
  }
};
var undefinedProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Undefined cannot be represented in JSON Schema");
  }
};
var voidProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Void cannot be represented in JSON Schema");
  }
};
var neverProcessor = (_schema, _ctx, json2, _params) => {
  json2.not = {};
};
var anyProcessor = (_schema, _ctx, _json, _params) => {
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {
};
var dateProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Date cannot be represented in JSON Schema");
  }
};
var enumProcessor = (schema, _ctx, json2, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json2.type = "number";
  if (values.every((v) => typeof v === "string"))
    json2.type = "string";
  json2.enum = values;
};
var literalProcessor = (schema, ctx, json2, _params) => {
  const def = schema._zod.def;
  const vals = [];
  for (const val of def.values) {
    if (val === void 0) {
      if (ctx.unrepresentable === "throw") {
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
      } else {
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {
  } else if (vals.length === 1) {
    const val = vals[0];
    json2.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json2.enum = [val];
    } else {
      json2.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json2.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json2.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json2.type = "boolean";
    if (vals.every((v) => v === null))
      json2.type = "null";
    json2.enum = vals;
  }
};
var nanProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("NaN cannot be represented in JSON Schema");
  }
};
var templateLiteralProcessor = (schema, _ctx, json2, _params) => {
  const _json = json2;
  const pattern = schema._zod.pattern;
  if (!pattern)
    throw new Error("Pattern not found in template literal");
  _json.type = "string";
  _json.pattern = pattern.source;
};
var fileProcessor = (schema, _ctx, json2, _params) => {
  const _json = json2;
  const file2 = {
    type: "string",
    format: "binary",
    contentEncoding: "binary"
  };
  const { minimum, maximum, mime } = schema._zod.bag;
  if (minimum !== void 0)
    file2.minLength = minimum;
  if (maximum !== void 0)
    file2.maxLength = maximum;
  if (mime) {
    if (mime.length === 1) {
      file2.contentMediaType = mime[0];
      Object.assign(_json, file2);
    } else {
      Object.assign(_json, file2);
      _json.anyOf = mime.map((m) => ({ contentMediaType: m }));
    }
  } else {
    Object.assign(_json, file2);
  }
};
var successProcessor = (_schema, _ctx, json2, _params) => {
  json2.type = "boolean";
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var functionProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Function types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var mapProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Map cannot be represented in JSON Schema");
  }
};
var setProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Set cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json2.minItems = minimum;
  if (typeof maximum === "number")
    json2.maxItems = maximum;
  json2.type = "array";
  json2.items = process(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
var objectProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  json2.type = "object";
  json2.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json2.properties[key] = process(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === void 0;
    } else {
      return v.optout === void 0;
    }
  }));
  if (requiredKeys.size > 0) {
    json2.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json2.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json2.additionalProperties = false;
  } else if (def.catchall) {
    json2.additionalProperties = process(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json2.oneOf = options;
  } else {
    json2.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const a = process(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json2.allOf = allOf;
};
var tupleProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  json2.type = "array";
  const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
  const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
  const prefixItems = def.items.map((x, i) => process(x, ctx, {
    ...params,
    path: [...params.path, prefixPath, i]
  }));
  const rest = def.rest ? process(def.rest, ctx, {
    ...params,
    path: [...params.path, restPath, ...ctx.target === "openapi-3.0" ? [def.items.length] : []]
  }) : null;
  if (ctx.target === "draft-2020-12") {
    json2.prefixItems = prefixItems;
    if (rest) {
      json2.items = rest;
    }
  } else if (ctx.target === "openapi-3.0") {
    json2.items = {
      anyOf: prefixItems
    };
    if (rest) {
      json2.items.anyOf.push(rest);
    }
    json2.minItems = prefixItems.length;
    if (!rest) {
      json2.maxItems = prefixItems.length;
    }
  } else {
    json2.items = prefixItems;
    if (rest) {
      json2.additionalItems = rest;
    }
  }
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json2.minItems = minimum;
  if (typeof maximum === "number")
    json2.maxItems = maximum;
};
var recordProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  json2.type = "object";
  const keyType = def.keyType;
  const keyBag = keyType._zod.bag;
  const patterns = keyBag?.patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = process(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json2.patternProperties = {};
    for (const pattern of patterns) {
      json2.patternProperties[pattern.source] = valueSchema;
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json2.propertyNames = process(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
    }
    json2.additionalProperties = process(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  if (keyValues) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json2.required = validKeyValues;
    }
  }
};
var nullableProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const inner = process(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json2.nullable = true;
  } else {
    json2.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  process(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json2.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  process(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json2._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  process(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json2.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  process(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  process(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json2.readOnly = true;
};
var promiseProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var lazyProcessor = (schema, ctx, _json, params) => {
  const innerType = schema._zod.innerType;
  process(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var allProcessors = {
  string: stringProcessor,
  number: numberProcessor,
  boolean: booleanProcessor,
  bigint: bigintProcessor,
  symbol: symbolProcessor,
  null: nullProcessor,
  undefined: undefinedProcessor,
  void: voidProcessor,
  never: neverProcessor,
  any: anyProcessor,
  unknown: unknownProcessor,
  date: dateProcessor,
  enum: enumProcessor,
  literal: literalProcessor,
  nan: nanProcessor,
  template_literal: templateLiteralProcessor,
  file: fileProcessor,
  success: successProcessor,
  custom: customProcessor,
  function: functionProcessor,
  transform: transformProcessor,
  map: mapProcessor,
  set: setProcessor,
  array: arrayProcessor,
  object: objectProcessor,
  union: unionProcessor,
  intersection: intersectionProcessor,
  tuple: tupleProcessor,
  record: recordProcessor,
  nullable: nullableProcessor,
  nonoptional: nonoptionalProcessor,
  default: defaultProcessor,
  prefault: prefaultProcessor,
  catch: catchProcessor,
  pipe: pipeProcessor,
  readonly: readonlyProcessor,
  promise: promiseProcessor,
  optional: optionalProcessor,
  lazy: lazyProcessor
};
function toJSONSchema(input, params) {
  if ("_idmap" in input) {
    const registry2 = input;
    const ctx2 = initializeContext({ ...params, processors: allProcessors });
    const defs = {};
    for (const entry of registry2._idmap.entries()) {
      const [_, schema] = entry;
      process(schema, ctx2);
    }
    const schemas = {};
    const external = {
      registry: registry2,
      uri: params?.uri,
      defs
    };
    ctx2.external = external;
    for (const entry of registry2._idmap.entries()) {
      const [key, schema] = entry;
      extractDefs(ctx2, schema);
      schemas[key] = finalize(ctx2, schema);
    }
    if (Object.keys(defs).length > 0) {
      const defsSegment = ctx2.target === "draft-2020-12" ? "$defs" : "definitions";
      schemas.__shared = {
        [defsSegment]: defs
      };
    }
    return { schemas };
  }
  const ctx = initializeContext({ ...params, processors: allProcessors });
  process(input, ctx);
  extractDefs(ctx, input);
  return finalize(ctx, input);
}

// node_modules/zod/v4/core/json-schema-generator.js
var JSONSchemaGenerator = class {
  /** @deprecated Access via ctx instead */
  get metadataRegistry() {
    return this.ctx.metadataRegistry;
  }
  /** @deprecated Access via ctx instead */
  get target() {
    return this.ctx.target;
  }
  /** @deprecated Access via ctx instead */
  get unrepresentable() {
    return this.ctx.unrepresentable;
  }
  /** @deprecated Access via ctx instead */
  get override() {
    return this.ctx.override;
  }
  /** @deprecated Access via ctx instead */
  get io() {
    return this.ctx.io;
  }
  /** @deprecated Access via ctx instead */
  get counter() {
    return this.ctx.counter;
  }
  set counter(value) {
    this.ctx.counter = value;
  }
  /** @deprecated Access via ctx instead */
  get seen() {
    return this.ctx.seen;
  }
  constructor(params) {
    let normalizedTarget = params?.target ?? "draft-2020-12";
    if (normalizedTarget === "draft-4")
      normalizedTarget = "draft-04";
    if (normalizedTarget === "draft-7")
      normalizedTarget = "draft-07";
    this.ctx = initializeContext({
      processors: allProcessors,
      target: normalizedTarget,
      ...params?.metadata && { metadata: params.metadata },
      ...params?.unrepresentable && { unrepresentable: params.unrepresentable },
      ...params?.override && { override: params.override },
      ...params?.io && { io: params.io }
    });
  }
  /**
   * Process a schema to prepare it for JSON Schema generation.
   * This must be called before emit().
   */
  process(schema, _params = { path: [], schemaPath: [] }) {
    return process(schema, this.ctx, _params);
  }
  /**
   * Emit the final JSON Schema after processing.
   * Must call process() first.
   */
  emit(schema, _params) {
    if (_params) {
      if (_params.cycles)
        this.ctx.cycles = _params.cycles;
      if (_params.reused)
        this.ctx.reused = _params.reused;
      if (_params.external)
        this.ctx.external = _params.external;
    }
    extractDefs(this.ctx, schema);
    const result = finalize(this.ctx, schema);
    const { "~standard": _, ...plainResult } = result;
    return plainResult;
  }
};

// node_modules/zod/v4/core/json-schema.js
var json_schema_exports = {};

// node_modules/zod/v4/classic/schemas.js
var schemas_exports2 = {};
__export(schemas_exports2, {
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBase64: () => ZodBase64,
  ZodBase64URL: () => ZodBase64URL,
  ZodBigInt: () => ZodBigInt,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBoolean: () => ZodBoolean,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCUID: () => ZodCUID,
  ZodCUID2: () => ZodCUID2,
  ZodCatch: () => ZodCatch,
  ZodCodec: () => ZodCodec,
  ZodCustom: () => ZodCustom,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodE164: () => ZodE164,
  ZodEmail: () => ZodEmail,
  ZodEmoji: () => ZodEmoji,
  ZodEnum: () => ZodEnum,
  ZodExactOptional: () => ZodExactOptional,
  ZodFile: () => ZodFile,
  ZodFunction: () => ZodFunction,
  ZodGUID: () => ZodGUID,
  ZodIPv4: () => ZodIPv4,
  ZodIPv6: () => ZodIPv6,
  ZodIntersection: () => ZodIntersection,
  ZodJWT: () => ZodJWT,
  ZodKSUID: () => ZodKSUID,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMAC: () => ZodMAC,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNanoID: () => ZodNanoID,
  ZodNever: () => ZodNever,
  ZodNonOptional: () => ZodNonOptional,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodPipe: () => ZodPipe,
  ZodPrefault: () => ZodPrefault,
  ZodPreprocess: () => ZodPreprocess,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodStringFormat: () => ZodStringFormat,
  ZodSuccess: () => ZodSuccess,
  ZodSymbol: () => ZodSymbol,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodTransform: () => ZodTransform,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodULID: () => ZodULID,
  ZodURL: () => ZodURL,
  ZodUUID: () => ZodUUID,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  ZodXID: () => ZodXID,
  ZodXor: () => ZodXor,
  _ZodString: () => _ZodString,
  _default: () => _default2,
  _function: () => _function,
  any: () => any,
  array: () => array,
  base64: () => base642,
  base64url: () => base64url2,
  bigint: () => bigint2,
  boolean: () => boolean2,
  catch: () => _catch2,
  check: () => check,
  cidrv4: () => cidrv42,
  cidrv6: () => cidrv62,
  codec: () => codec,
  cuid: () => cuid3,
  cuid2: () => cuid22,
  custom: () => custom,
  date: () => date3,
  describe: () => describe2,
  discriminatedUnion: () => discriminatedUnion,
  e164: () => e1642,
  email: () => email2,
  emoji: () => emoji2,
  enum: () => _enum2,
  exactOptional: () => exactOptional,
  file: () => file,
  float32: () => float32,
  float64: () => float64,
  function: () => _function,
  guid: () => guid2,
  hash: () => hash,
  hex: () => hex2,
  hostname: () => hostname2,
  httpUrl: () => httpUrl,
  instanceof: () => _instanceof,
  int: () => int,
  int32: () => int32,
  int64: () => int64,
  intersection: () => intersection,
  invertCodec: () => invertCodec,
  ipv4: () => ipv42,
  ipv6: () => ipv62,
  json: () => json,
  jwt: () => jwt,
  keyof: () => keyof,
  ksuid: () => ksuid2,
  lazy: () => lazy,
  literal: () => literal,
  looseObject: () => looseObject,
  looseRecord: () => looseRecord,
  mac: () => mac2,
  map: () => map,
  meta: () => meta2,
  nan: () => nan,
  nanoid: () => nanoid2,
  nativeEnum: () => nativeEnum,
  never: () => never,
  nonoptional: () => nonoptional,
  null: () => _null3,
  nullable: () => nullable,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional,
  partialRecord: () => partialRecord,
  pipe: () => pipe,
  prefault: () => prefault,
  preprocess: () => preprocess,
  promise: () => promise,
  readonly: () => readonly,
  record: () => record,
  refine: () => refine,
  set: () => set,
  strictObject: () => strictObject,
  string: () => string2,
  stringFormat: () => stringFormat,
  stringbool: () => stringbool,
  success: () => success,
  superRefine: () => superRefine,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  transform: () => transform,
  tuple: () => tuple,
  uint32: () => uint32,
  uint64: () => uint64,
  ulid: () => ulid2,
  undefined: () => _undefined3,
  union: () => union,
  unknown: () => unknown,
  url: () => url,
  uuid: () => uuid2,
  uuidv4: () => uuidv4,
  uuidv6: () => uuidv6,
  uuidv7: () => uuidv7,
  void: () => _void2,
  xid: () => xid2,
  xor: () => xor
});

// node_modules/zod/v4/classic/checks.js
var checks_exports2 = {};
__export(checks_exports2, {
  endsWith: () => _endsWith,
  gt: () => _gt,
  gte: () => _gte,
  includes: () => _includes,
  length: () => _length,
  lowercase: () => _lowercase,
  lt: () => _lt,
  lte: () => _lte,
  maxLength: () => _maxLength,
  maxSize: () => _maxSize,
  mime: () => _mime,
  minLength: () => _minLength,
  minSize: () => _minSize,
  multipleOf: () => _multipleOf,
  negative: () => _negative,
  nonnegative: () => _nonnegative,
  nonpositive: () => _nonpositive,
  normalize: () => _normalize,
  overwrite: () => _overwrite,
  positive: () => _positive,
  property: () => _property,
  regex: () => _regex,
  size: () => _size,
  slugify: () => _slugify,
  startsWith: () => _startsWith,
  toLowerCase: () => _toLowerCase,
  toUpperCase: () => _toUpperCase,
  trim: () => _trim,
  uppercase: () => _uppercase
});

// node_modules/zod/v4/classic/iso.js
var iso_exports = {};
__export(iso_exports, {
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  date: () => date2,
  datetime: () => datetime2,
  duration: () => duration2,
  time: () => time2
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
      // enumerable: false,
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
      // enumerable: false,
    },
    addIssue: {
      value: (issue2) => {
        inst.issues.push(issue2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
      // enumerable: false,
    },
    addIssues: {
      value: (issues2) => {
        inst.issues.push(...issues2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
      // enumerable: false,
    }
  });
};
var ZodError = /* @__PURE__ */ $constructor("ZodError", initializer2);
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, {
  Parent: Error
});

// node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode2 = /* @__PURE__ */ _encode(ZodRealError);
var decode2 = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync2 = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync2 = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode2 = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode2 = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync2 = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync2 = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = /* @__PURE__ */ new Set();
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group))
    return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v
        });
      }
    });
  }
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse2(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode2(inst, data, params);
  inst.decode = (data, params) => decode2(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync2(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync2(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode2(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode2(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync2(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync2(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def2 = this.def;
      return this.clone(util_exports.mergeDefs(def2, {
        checks: [
          ...def2.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def2, params) {
      return clone(this, def2, params);
    },
    brand() {
      return this;
    },
    register(reg, meta3) {
      reg.add(this, meta3);
      return this;
    },
    refine(check2, params) {
      return this.check(refine(check2, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(_overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default2(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch2(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0)
        return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(void 0).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    }
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => stringProcessor(inst, ctx, json2, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  });
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function email2(params) {
  return _email(ZodEmail, params);
}
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function guid2(params) {
  return _guid(ZodGUID, params);
}
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function uuid2(params) {
  return _uuid(ZodUUID, params);
}
function uuidv4(params) {
  return _uuidv4(ZodUUID, params);
}
function uuidv6(params) {
  return _uuidv6(ZodUUID, params);
}
function uuidv7(params) {
  return _uuidv7(ZodUUID, params);
}
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return _url(ZodURL, params);
}
function httpUrl(params) {
  return _url(ZodURL, {
    protocol: regexes_exports.httpProtocol,
    hostname: regexes_exports.domain,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function emoji2(params) {
  return _emoji2(ZodEmoji, params);
}
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function nanoid2(params) {
  return _nanoid(ZodNanoID, params);
}
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cuid3(params) {
  return _cuid(ZodCUID, params);
}
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cuid22(params) {
  return _cuid2(ZodCUID2, params);
}
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ulid2(params) {
  return _ulid(ZodULID, params);
}
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function xid2(params) {
  return _xid(ZodXID, params);
}
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ksuid2(params) {
  return _ksuid(ZodKSUID, params);
}
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ipv42(params) {
  return _ipv4(ZodIPv4, params);
}
var ZodMAC = /* @__PURE__ */ $constructor("ZodMAC", (inst, def) => {
  $ZodMAC.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function mac2(params) {
  return _mac(ZodMAC, params);
}
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ipv62(params) {
  return _ipv6(ZodIPv6, params);
}
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cidrv42(params) {
  return _cidrv4(ZodCIDRv4, params);
}
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cidrv62(params) {
  return _cidrv6(ZodCIDRv6, params);
}
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base642(params) {
  return _base64(ZodBase64, params);
}
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base64url2(params) {
  return _base64url(ZodBase64URL, params);
}
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function e1642(params) {
  return _e164(ZodE164, params);
}
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function jwt(params) {
  return _jwt(ZodJWT, params);
}
var ZodCustomStringFormat = /* @__PURE__ */ $constructor("ZodCustomStringFormat", (inst, def) => {
  $ZodCustomStringFormat.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function stringFormat(format, fnOrRegex, _params = {}) {
  return _stringFormat(ZodCustomStringFormat, format, fnOrRegex, _params);
}
function hostname2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hostname", regexes_exports.hostname, _params);
}
function hex2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hex", regexes_exports.hex, _params);
}
function hash(alg, params) {
  const enc = params?.enc ?? "hex";
  const format = `${alg}_${enc}`;
  const regex = regexes_exports[format];
  if (!regex)
    throw new Error(`Unrecognized hash format: ${format}`);
  return _stringFormat(ZodCustomStringFormat, format, regex, params);
}
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => numberProcessor(inst, ctx, json2, params);
  _installLazyMethods(inst, "ZodNumber", {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  });
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
function float32(params) {
  return _float32(ZodNumberFormat, params);
}
function float64(params) {
  return _float64(ZodNumberFormat, params);
}
function int32(params) {
  return _int32(ZodNumberFormat, params);
}
function uint32(params) {
  return _uint32(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => booleanProcessor(inst, ctx, json2, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodBigInt = /* @__PURE__ */ $constructor("ZodBigInt", (inst, def) => {
  $ZodBigInt.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => bigintProcessor(inst, ctx, json2, params);
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.positive = (params) => inst.check(_gt(BigInt(0), params));
  inst.negative = (params) => inst.check(_lt(BigInt(0), params));
  inst.nonpositive = (params) => inst.check(_lte(BigInt(0), params));
  inst.nonnegative = (params) => inst.check(_gte(BigInt(0), params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  const bag = inst._zod.bag;
  inst.minValue = bag.minimum ?? null;
  inst.maxValue = bag.maximum ?? null;
  inst.format = bag.format ?? null;
});
function bigint2(params) {
  return _bigint(ZodBigInt, params);
}
var ZodBigIntFormat = /* @__PURE__ */ $constructor("ZodBigIntFormat", (inst, def) => {
  $ZodBigIntFormat.init(inst, def);
  ZodBigInt.init(inst, def);
});
function int64(params) {
  return _int64(ZodBigIntFormat, params);
}
function uint64(params) {
  return _uint64(ZodBigIntFormat, params);
}
var ZodSymbol = /* @__PURE__ */ $constructor("ZodSymbol", (inst, def) => {
  $ZodSymbol.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => symbolProcessor(inst, ctx, json2, params);
});
function symbol(params) {
  return _symbol(ZodSymbol, params);
}
var ZodUndefined = /* @__PURE__ */ $constructor("ZodUndefined", (inst, def) => {
  $ZodUndefined.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => undefinedProcessor(inst, ctx, json2, params);
});
function _undefined3(params) {
  return _undefined2(ZodUndefined, params);
}
var ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nullProcessor(inst, ctx, json2, params);
});
function _null3(params) {
  return _null2(ZodNull, params);
}
var ZodAny = /* @__PURE__ */ $constructor("ZodAny", (inst, def) => {
  $ZodAny.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => anyProcessor(inst, ctx, json2, params);
});
function any() {
  return _any(ZodAny);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unknownProcessor(inst, ctx, json2, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => neverProcessor(inst, ctx, json2, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodVoid = /* @__PURE__ */ $constructor("ZodVoid", (inst, def) => {
  $ZodVoid.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => voidProcessor(inst, ctx, json2, params);
});
function _void2(params) {
  return _void(ZodVoid, params);
}
var ZodDate = /* @__PURE__ */ $constructor("ZodDate", (inst, def) => {
  $ZodDate.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => dateProcessor(inst, ctx, json2, params);
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  const c = inst._zod.bag;
  inst.minDate = c.minimum ? new Date(c.minimum) : null;
  inst.maxDate = c.maximum ? new Date(c.maximum) : null;
});
function date3(params) {
  return _date(ZodDate, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => arrayProcessor(inst, ctx, json2, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(_minLength(n, params));
    },
    nonempty(params) {
      return this.check(_minLength(1, params));
    },
    max(n, params) {
      return this.check(_maxLength(n, params));
    },
    length(n, params) {
      return this.check(_length(n, params));
    },
    unwrap() {
      return this.element;
    }
  });
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
function keyof(schema) {
  const shape = schema._zod.def.shape;
  return _enum2(Object.keys(shape));
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => objectProcessor(inst, ctx, json2, params);
  util_exports.defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum2(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({ ...this._zod.def, catchall });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: never() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: void 0 });
    },
    extend(incoming) {
      return util_exports.extend(this, incoming);
    },
    safeExtend(incoming) {
      return util_exports.safeExtend(this, incoming);
    },
    merge(other) {
      return util_exports.merge(this, other);
    },
    pick(mask) {
      return util_exports.pick(this, mask);
    },
    omit(mask) {
      return util_exports.omit(this, mask);
    },
    partial(...args) {
      return util_exports.partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return util_exports.required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...util_exports.normalizeParams(params)
  });
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...util_exports.normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
var ZodXor = /* @__PURE__ */ $constructor("ZodXor", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodXor.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
  inst.options = def.options;
});
function xor(options, params) {
  return new ZodXor({
    type: "union",
    options,
    inclusive: false,
    ...util_exports.normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...util_exports.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => intersectionProcessor(inst, ctx, json2, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodTuple = /* @__PURE__ */ $constructor("ZodTuple", (inst, def) => {
  $ZodTuple.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => tupleProcessor(inst, ctx, json2, params);
  inst.rest = (rest) => inst.clone({
    ...inst._zod.def,
    rest
  });
});
function tuple(items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new ZodTuple({
    type: "tuple",
    items,
    rest,
    ...util_exports.normalizeParams(params)
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => recordProcessor(inst, ctx, json2, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...util_exports.normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
function partialRecord(keyType, valueType, params) {
  const k = clone(keyType);
  k._zod.values = void 0;
  return new ZodRecord({
    type: "record",
    keyType: k,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
function looseRecord(keyType, valueType, params) {
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    mode: "loose",
    ...util_exports.normalizeParams(params)
  });
}
var ZodMap = /* @__PURE__ */ $constructor("ZodMap", (inst, def) => {
  $ZodMap.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => mapProcessor(inst, ctx, json2, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
  inst.min = (...args) => inst.check(_minSize(...args));
  inst.nonempty = (params) => inst.check(_minSize(1, params));
  inst.max = (...args) => inst.check(_maxSize(...args));
  inst.size = (...args) => inst.check(_size(...args));
});
function map(keyType, valueType, params) {
  return new ZodMap({
    type: "map",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodSet = /* @__PURE__ */ $constructor("ZodSet", (inst, def) => {
  $ZodSet.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => setProcessor(inst, ctx, json2, params);
  inst.min = (...args) => inst.check(_minSize(...args));
  inst.nonempty = (params) => inst.check(_minSize(1, params));
  inst.max = (...args) => inst.check(_maxSize(...args));
  inst.size = (...args) => inst.check(_size(...args));
});
function set(valueType, params) {
  return new ZodSet({
    type: "set",
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => enumProcessor(inst, ctx, json2, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum2(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
function nativeEnum(entries, params) {
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => literalProcessor(inst, ctx, json2, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...util_exports.normalizeParams(params)
  });
}
var ZodFile = /* @__PURE__ */ $constructor("ZodFile", (inst, def) => {
  $ZodFile.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => fileProcessor(inst, ctx, json2, params);
  inst.min = (size, params) => inst.check(_minSize(size, params));
  inst.max = (size, params) => inst.check(_maxSize(size, params));
  inst.mime = (types2, params) => inst.check(_mime(Array.isArray(types2) ? types2 : [types2], params));
});
function file(params) {
  return _file(ZodFile, params);
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => transformProcessor(inst, ctx, json2, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        payload.fallback = true;
        return payload;
      });
    }
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nullableProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
function nullish2(innerType) {
  return optional(nullable(innerType));
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => defaultProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default2(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => prefaultProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nonoptionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodSuccess = /* @__PURE__ */ $constructor("ZodSuccess", (inst, def) => {
  $ZodSuccess.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => successProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function success(innerType) {
  return new ZodSuccess({
    type: "success",
    innerType
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => catchProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch2(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodNaN = /* @__PURE__ */ $constructor("ZodNaN", (inst, def) => {
  $ZodNaN.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nanProcessor(inst, ctx, json2, params);
});
function nan(params) {
  return _nan(ZodNaN, params);
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => pipeProcessor(inst, ctx, json2, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
var ZodCodec = /* @__PURE__ */ $constructor("ZodCodec", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodCodec.init(inst, def);
});
function codec(in_, out, params) {
  return new ZodCodec({
    type: "pipe",
    in: in_,
    out,
    transform: params.decode,
    reverseTransform: params.encode
  });
}
function invertCodec(codec2) {
  const def = codec2._zod.def;
  return new ZodCodec({
    type: "pipe",
    in: def.out,
    out: def.in,
    transform: def.reverseTransform,
    reverseTransform: def.transform
  });
}
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodPreprocess.init(inst, def);
});
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => readonlyProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodTemplateLiteral = /* @__PURE__ */ $constructor("ZodTemplateLiteral", (inst, def) => {
  $ZodTemplateLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => templateLiteralProcessor(inst, ctx, json2, params);
});
function templateLiteral(parts, params) {
  return new ZodTemplateLiteral({
    type: "template_literal",
    parts,
    ...util_exports.normalizeParams(params)
  });
}
var ZodLazy = /* @__PURE__ */ $constructor("ZodLazy", (inst, def) => {
  $ZodLazy.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => lazyProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.getter();
});
function lazy(getter) {
  return new ZodLazy({
    type: "lazy",
    getter
  });
}
var ZodPromise = /* @__PURE__ */ $constructor("ZodPromise", (inst, def) => {
  $ZodPromise.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => promiseProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function promise(innerType) {
  return new ZodPromise({
    type: "promise",
    innerType
  });
}
var ZodFunction = /* @__PURE__ */ $constructor("ZodFunction", (inst, def) => {
  $ZodFunction.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => functionProcessor(inst, ctx, json2, params);
});
function _function(params) {
  return new ZodFunction({
    type: "function",
    input: Array.isArray(params?.input) ? tuple(params?.input) : params?.input ?? array(unknown()),
    output: params?.output ?? unknown()
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => customProcessor(inst, ctx, json2, params);
});
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
    // ...util.normalizeParams(params),
  });
  ch._zod.check = fn;
  return ch;
}
function custom(fn, _params) {
  return _custom(ZodCustom, fn ?? (() => true), _params);
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
var describe2 = describe;
var meta2 = meta;
function _instanceof(cls, params = {}) {
  const inst = new ZodCustom({
    type: "custom",
    check: "custom",
    fn: (data) => data instanceof cls,
    abort: true,
    ...util_exports.normalizeParams(params)
  });
  inst._zod.bag.Class = cls;
  inst._zod.check = (payload) => {
    if (!(payload.value instanceof cls)) {
      payload.issues.push({
        code: "invalid_type",
        expected: cls.name,
        input: payload.value,
        inst,
        path: [...inst._zod.def.path ?? []]
      });
    }
  };
  return inst;
}
var stringbool = (...args) => _stringbool({
  Codec: ZodCodec,
  Boolean: ZodBoolean,
  String: ZodString
}, ...args);
function json(params) {
  const jsonSchema = lazy(() => {
    return union([string2(params), number2(), boolean2(), _null3(), array(jsonSchema), record(string2(), jsonSchema)]);
  });
  return jsonSchema;
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}

// node_modules/zod/v4/classic/compat.js
var ZodIssueCode = {
  invalid_type: "invalid_type",
  too_big: "too_big",
  too_small: "too_small",
  invalid_format: "invalid_format",
  not_multiple_of: "not_multiple_of",
  unrecognized_keys: "unrecognized_keys",
  invalid_union: "invalid_union",
  invalid_key: "invalid_key",
  invalid_element: "invalid_element",
  invalid_value: "invalid_value",
  custom: "custom"
};
function setErrorMap(map2) {
  config({
    customError: map2
  });
}
function getErrorMap() {
  return config().customError;
}
var ZodFirstPartyTypeKind;
/* @__PURE__ */ (function(ZodFirstPartyTypeKind2) {
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));

// node_modules/zod/v4/classic/from-json-schema.js
var z = {
  ...schemas_exports2,
  ...checks_exports2,
  iso: iso_exports
};
var RECOGNIZED_KEYS = /* @__PURE__ */ new Set([
  // Schema identification
  "$schema",
  "$ref",
  "$defs",
  "definitions",
  // Core schema keywords
  "$id",
  "id",
  "$comment",
  "$anchor",
  "$vocabulary",
  "$dynamicRef",
  "$dynamicAnchor",
  // Type
  "type",
  "enum",
  "const",
  // Composition
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  // Object
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  // Array
  "items",
  "prefixItems",
  "additionalItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  // String
  "minLength",
  "maxLength",
  "pattern",
  "format",
  // Number
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  // Already handled metadata
  "description",
  "default",
  // Content
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  // Unsupported (error-throwing)
  "unevaluatedItems",
  "unevaluatedProperties",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "dependentRequired",
  // OpenAPI
  "nullable",
  "readOnly"
]);
function detectVersion(schema, defaultTarget) {
  const $schema = schema.$schema;
  if ($schema === "https://json-schema.org/draft/2020-12/schema") {
    return "draft-2020-12";
  }
  if ($schema === "http://json-schema.org/draft-07/schema#") {
    return "draft-7";
  }
  if ($schema === "http://json-schema.org/draft-04/schema#") {
    return "draft-4";
  }
  return defaultTarget ?? "draft-2020-12";
}
function resolveRef(ref, ctx) {
  if (!ref.startsWith("#")) {
    throw new Error("External $ref is not supported, only local refs (#/...) are allowed");
  }
  const path = ref.slice(1).split("/").filter(Boolean);
  if (path.length === 0) {
    return ctx.rootSchema;
  }
  const defsKey = ctx.version === "draft-2020-12" ? "$defs" : "definitions";
  if (path[0] === defsKey) {
    const key = path[1];
    if (!key || !ctx.defs[key]) {
      throw new Error(`Reference not found: ${ref}`);
    }
    return ctx.defs[key];
  }
  throw new Error(`Reference not found: ${ref}`);
}
function convertBaseSchema(schema, ctx) {
  if (schema.not !== void 0) {
    if (typeof schema.not === "object" && Object.keys(schema.not).length === 0) {
      return z.never();
    }
    throw new Error("not is not supported in Zod (except { not: {} } for never)");
  }
  if (schema.unevaluatedItems !== void 0) {
    throw new Error("unevaluatedItems is not supported");
  }
  if (schema.unevaluatedProperties !== void 0) {
    throw new Error("unevaluatedProperties is not supported");
  }
  if (schema.if !== void 0 || schema.then !== void 0 || schema.else !== void 0) {
    throw new Error("Conditional schemas (if/then/else) are not supported");
  }
  if (schema.dependentSchemas !== void 0 || schema.dependentRequired !== void 0) {
    throw new Error("dependentSchemas and dependentRequired are not supported");
  }
  if (schema.$ref) {
    const refPath = schema.$ref;
    if (ctx.refs.has(refPath)) {
      return ctx.refs.get(refPath);
    }
    if (ctx.processing.has(refPath)) {
      return z.lazy(() => {
        if (!ctx.refs.has(refPath)) {
          throw new Error(`Circular reference not resolved: ${refPath}`);
        }
        return ctx.refs.get(refPath);
      });
    }
    ctx.processing.add(refPath);
    const resolved = resolveRef(refPath, ctx);
    const zodSchema2 = convertSchema(resolved, ctx);
    ctx.refs.set(refPath, zodSchema2);
    ctx.processing.delete(refPath);
    return zodSchema2;
  }
  if (schema.enum !== void 0) {
    const enumValues = schema.enum;
    if (ctx.version === "openapi-3.0" && schema.nullable === true && enumValues.length === 1 && enumValues[0] === null) {
      return z.null();
    }
    if (enumValues.length === 0) {
      return z.never();
    }
    if (enumValues.length === 1) {
      return z.literal(enumValues[0]);
    }
    if (enumValues.every((v) => typeof v === "string")) {
      return z.enum(enumValues);
    }
    const literalSchemas = enumValues.map((v) => z.literal(v));
    if (literalSchemas.length < 2) {
      return literalSchemas[0];
    }
    return z.union([literalSchemas[0], literalSchemas[1], ...literalSchemas.slice(2)]);
  }
  if (schema.const !== void 0) {
    return z.literal(schema.const);
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    const typeSchemas = type.map((t) => {
      const typeSchema = { ...schema, type: t };
      return convertBaseSchema(typeSchema, ctx);
    });
    if (typeSchemas.length === 0) {
      return z.never();
    }
    if (typeSchemas.length === 1) {
      return typeSchemas[0];
    }
    return z.union(typeSchemas);
  }
  if (!type) {
    return z.any();
  }
  let zodSchema;
  switch (type) {
    case "string": {
      let stringSchema = z.string();
      if (schema.format) {
        const format = schema.format;
        if (format === "email") {
          stringSchema = stringSchema.check(z.email());
        } else if (format === "uri" || format === "uri-reference") {
          stringSchema = stringSchema.check(z.url());
        } else if (format === "uuid" || format === "guid") {
          stringSchema = stringSchema.check(z.uuid());
        } else if (format === "date-time") {
          stringSchema = stringSchema.check(z.iso.datetime());
        } else if (format === "date") {
          stringSchema = stringSchema.check(z.iso.date());
        } else if (format === "time") {
          stringSchema = stringSchema.check(z.iso.time());
        } else if (format === "duration") {
          stringSchema = stringSchema.check(z.iso.duration());
        } else if (format === "ipv4") {
          stringSchema = stringSchema.check(z.ipv4());
        } else if (format === "ipv6") {
          stringSchema = stringSchema.check(z.ipv6());
        } else if (format === "mac") {
          stringSchema = stringSchema.check(z.mac());
        } else if (format === "cidr") {
          stringSchema = stringSchema.check(z.cidrv4());
        } else if (format === "cidr-v6") {
          stringSchema = stringSchema.check(z.cidrv6());
        } else if (format === "base64") {
          stringSchema = stringSchema.check(z.base64());
        } else if (format === "base64url") {
          stringSchema = stringSchema.check(z.base64url());
        } else if (format === "e164") {
          stringSchema = stringSchema.check(z.e164());
        } else if (format === "jwt") {
          stringSchema = stringSchema.check(z.jwt());
        } else if (format === "emoji") {
          stringSchema = stringSchema.check(z.emoji());
        } else if (format === "nanoid") {
          stringSchema = stringSchema.check(z.nanoid());
        } else if (format === "cuid") {
          stringSchema = stringSchema.check(z.cuid());
        } else if (format === "cuid2") {
          stringSchema = stringSchema.check(z.cuid2());
        } else if (format === "ulid") {
          stringSchema = stringSchema.check(z.ulid());
        } else if (format === "xid") {
          stringSchema = stringSchema.check(z.xid());
        } else if (format === "ksuid") {
          stringSchema = stringSchema.check(z.ksuid());
        }
      }
      if (typeof schema.minLength === "number") {
        stringSchema = stringSchema.min(schema.minLength);
      }
      if (typeof schema.maxLength === "number") {
        stringSchema = stringSchema.max(schema.maxLength);
      }
      if (schema.pattern) {
        stringSchema = stringSchema.regex(new RegExp(schema.pattern));
      }
      zodSchema = stringSchema;
      break;
    }
    case "number":
    case "integer": {
      let numberSchema = type === "integer" ? z.number().int() : z.number();
      if (typeof schema.minimum === "number") {
        numberSchema = numberSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === "number") {
        numberSchema = numberSchema.max(schema.maximum);
      }
      if (typeof schema.exclusiveMinimum === "number") {
        numberSchema = numberSchema.gt(schema.exclusiveMinimum);
      } else if (schema.exclusiveMinimum === true && typeof schema.minimum === "number") {
        numberSchema = numberSchema.gt(schema.minimum);
      }
      if (typeof schema.exclusiveMaximum === "number") {
        numberSchema = numberSchema.lt(schema.exclusiveMaximum);
      } else if (schema.exclusiveMaximum === true && typeof schema.maximum === "number") {
        numberSchema = numberSchema.lt(schema.maximum);
      }
      if (typeof schema.multipleOf === "number") {
        numberSchema = numberSchema.multipleOf(schema.multipleOf);
      }
      zodSchema = numberSchema;
      break;
    }
    case "boolean": {
      zodSchema = z.boolean();
      break;
    }
    case "null": {
      zodSchema = z.null();
      break;
    }
    case "object": {
      const shape = {};
      const properties = schema.properties || {};
      const requiredSet = new Set(schema.required || []);
      for (const [key, propSchema] of Object.entries(properties)) {
        const propZodSchema = convertSchema(propSchema, ctx);
        shape[key] = requiredSet.has(key) ? propZodSchema : propZodSchema.optional();
      }
      if (schema.propertyNames) {
        const keySchema = convertSchema(schema.propertyNames, ctx);
        const valueSchema = schema.additionalProperties && typeof schema.additionalProperties === "object" ? convertSchema(schema.additionalProperties, ctx) : z.any();
        if (Object.keys(shape).length === 0) {
          zodSchema = z.record(keySchema, valueSchema);
          break;
        }
        const objectSchema2 = z.object(shape).passthrough();
        const recordSchema = z.looseRecord(keySchema, valueSchema);
        zodSchema = z.intersection(objectSchema2, recordSchema);
        break;
      }
      if (schema.patternProperties) {
        const patternProps = schema.patternProperties;
        const patternKeys = Object.keys(patternProps);
        const looseRecords = [];
        for (const pattern of patternKeys) {
          const patternValue = convertSchema(patternProps[pattern], ctx);
          const keySchema = z.string().regex(new RegExp(pattern));
          looseRecords.push(z.looseRecord(keySchema, patternValue));
        }
        const schemasToIntersect = [];
        if (Object.keys(shape).length > 0) {
          schemasToIntersect.push(z.object(shape).passthrough());
        }
        schemasToIntersect.push(...looseRecords);
        if (schemasToIntersect.length === 0) {
          zodSchema = z.object({}).passthrough();
        } else if (schemasToIntersect.length === 1) {
          zodSchema = schemasToIntersect[0];
        } else {
          let result = z.intersection(schemasToIntersect[0], schemasToIntersect[1]);
          for (let i = 2; i < schemasToIntersect.length; i++) {
            result = z.intersection(result, schemasToIntersect[i]);
          }
          zodSchema = result;
        }
        break;
      }
      const objectSchema = z.object(shape);
      if (schema.additionalProperties === false) {
        zodSchema = objectSchema.strict();
      } else if (typeof schema.additionalProperties === "object") {
        zodSchema = objectSchema.catchall(convertSchema(schema.additionalProperties, ctx));
      } else {
        zodSchema = objectSchema.passthrough();
      }
      break;
    }
    case "array": {
      const prefixItems = schema.prefixItems;
      const items = schema.items;
      if (prefixItems && Array.isArray(prefixItems)) {
        const tupleItems = prefixItems.map((item) => convertSchema(item, ctx));
        const rest = items && typeof items === "object" && !Array.isArray(items) ? convertSchema(items, ctx) : void 0;
        if (rest) {
          zodSchema = z.tuple(tupleItems).rest(rest);
        } else {
          zodSchema = z.tuple(tupleItems);
        }
        if (typeof schema.minItems === "number") {
          zodSchema = zodSchema.check(z.minLength(schema.minItems));
        }
        if (typeof schema.maxItems === "number") {
          zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
        }
      } else if (Array.isArray(items)) {
        const tupleItems = items.map((item) => convertSchema(item, ctx));
        const rest = schema.additionalItems && typeof schema.additionalItems === "object" ? convertSchema(schema.additionalItems, ctx) : void 0;
        if (rest) {
          zodSchema = z.tuple(tupleItems).rest(rest);
        } else {
          zodSchema = z.tuple(tupleItems);
        }
        if (typeof schema.minItems === "number") {
          zodSchema = zodSchema.check(z.minLength(schema.minItems));
        }
        if (typeof schema.maxItems === "number") {
          zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
        }
      } else if (items !== void 0) {
        const element = convertSchema(items, ctx);
        let arraySchema = z.array(element);
        if (typeof schema.minItems === "number") {
          arraySchema = arraySchema.min(schema.minItems);
        }
        if (typeof schema.maxItems === "number") {
          arraySchema = arraySchema.max(schema.maxItems);
        }
        zodSchema = arraySchema;
      } else {
        zodSchema = z.array(z.any());
      }
      break;
    }
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
  return zodSchema;
}
function convertSchema(schema, ctx) {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }
  let baseSchema = convertBaseSchema(schema, ctx);
  const hasExplicitType = schema.type || schema.enum !== void 0 || schema.const !== void 0;
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const options = schema.anyOf.map((s) => convertSchema(s, ctx));
    const anyOfUnion = z.union(options);
    baseSchema = hasExplicitType ? z.intersection(baseSchema, anyOfUnion) : anyOfUnion;
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const options = schema.oneOf.map((s) => convertSchema(s, ctx));
    const oneOfUnion = z.xor(options);
    baseSchema = hasExplicitType ? z.intersection(baseSchema, oneOfUnion) : oneOfUnion;
  }
  if (schema.allOf && Array.isArray(schema.allOf)) {
    if (schema.allOf.length === 0) {
      baseSchema = hasExplicitType ? baseSchema : z.any();
    } else {
      let result = hasExplicitType ? baseSchema : convertSchema(schema.allOf[0], ctx);
      const startIdx = hasExplicitType ? 0 : 1;
      for (let i = startIdx; i < schema.allOf.length; i++) {
        result = z.intersection(result, convertSchema(schema.allOf[i], ctx));
      }
      baseSchema = result;
    }
  }
  if (schema.nullable === true && ctx.version === "openapi-3.0") {
    baseSchema = z.nullable(baseSchema);
  }
  if (schema.readOnly === true) {
    baseSchema = z.readonly(baseSchema);
  }
  if (schema.default !== void 0) {
    baseSchema = baseSchema.default(schema.default);
  }
  const extraMeta = {};
  const coreMetadataKeys = ["$id", "id", "$comment", "$anchor", "$vocabulary", "$dynamicRef", "$dynamicAnchor"];
  for (const key of coreMetadataKeys) {
    if (key in schema) {
      extraMeta[key] = schema[key];
    }
  }
  const contentMetadataKeys = ["contentEncoding", "contentMediaType", "contentSchema"];
  for (const key of contentMetadataKeys) {
    if (key in schema) {
      extraMeta[key] = schema[key];
    }
  }
  for (const key of Object.keys(schema)) {
    if (!RECOGNIZED_KEYS.has(key)) {
      extraMeta[key] = schema[key];
    }
  }
  if (Object.keys(extraMeta).length > 0) {
    ctx.registry.add(baseSchema, extraMeta);
  }
  if (schema.description) {
    baseSchema = baseSchema.describe(schema.description);
  }
  return baseSchema;
}
function fromJSONSchema(schema, params) {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }
  let normalized;
  try {
    normalized = JSON.parse(JSON.stringify(schema));
  } catch {
    throw new Error("fromJSONSchema input is not valid JSON (possibly cyclic); use $defs/$ref for recursive schemas");
  }
  const version2 = detectVersion(normalized, params?.defaultTarget);
  const defs = normalized.$defs || normalized.definitions || {};
  const ctx = {
    version: version2,
    defs,
    refs: /* @__PURE__ */ new Map(),
    processing: /* @__PURE__ */ new Set(),
    rootSchema: normalized,
    registry: params?.registry ?? globalRegistry
  };
  return convertSchema(normalized, ctx);
}

// node_modules/zod/v4/classic/coerce.js
var coerce_exports = {};
__export(coerce_exports, {
  bigint: () => bigint3,
  boolean: () => boolean3,
  date: () => date4,
  number: () => number3,
  string: () => string3
});
function string3(params) {
  return _coercedString(ZodString, params);
}
function number3(params) {
  return _coercedNumber(ZodNumber, params);
}
function boolean3(params) {
  return _coercedBoolean(ZodBoolean, params);
}
function bigint3(params) {
  return _coercedBigint(ZodBigInt, params);
}
function date4(params) {
  return _coercedDate(ZodDate, params);
}

// node_modules/zod/v4/classic/external.js
config(en_default());

// client/src/image-models.mjs
var IMAGE_GEN_MODELS = Object.freeze([
  "Nano Banana",
  "MidJourney",
  "DALL-E",
  "Stable Diffusion",
  "Flux",
  "Imagen",
  "Ideogram",
  "Leonardo",
  "Firefly",
  "Recraft",
  "Qwen Image",
  "Seedream"
]);
var MODEL_TOKENS = Object.freeze([
  "nanobanana",
  "midjourney",
  "dalle",
  "stablediffusion",
  "flux",
  "imagen",
  "ideogram",
  "leonardo",
  "firefly",
  "recraft",
  "qwenimage",
  "seedream"
]);
function normalize(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function isImageGenModel(target) {
  const n = normalize(target);
  if (!n) return false;
  return MODEL_TOKENS.some((tok) => n.includes(tok));
}
function isImageGenTarget(targets) {
  return Array.isArray(targets) && targets.some(isImageGenModel);
}

// src/lib/banner-presets.mjs
var BANNER_PRESETS = [
  { key: "green", label: "Green", from: "#1f9e5f", to: "#25232b" },
  { key: "amber", label: "Amber", from: "#b57616", to: "#25232b" },
  { key: "ink", label: "Ink", from: "#393542", to: "#25232b" },
  // today's existing default hero, unchanged
  { key: "wordpress", label: "WordPress", from: "#5a8de0", to: "#25232b" },
  { key: "ide-plugins", label: "IDE Plugins", from: "#9277d4", to: "#25232b" },
  { key: "mods", label: "Mods", from: "#d8a847", to: "#25232b" }
];
var BANNER_PRESET_KEYS = BANNER_PRESETS.map((p) => p.key);

// client/src/schemas.mjs
var STATUS = external_exports.enum(["draft", "published"]);
var VISIBILITY = external_exports.enum(["public", "members"]);
function normalizeTag(t) {
  return String(t ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
}
var TAG_KEBAB_RE = /^[a-z0-9][a-z0-9.-]*$/;
var tagsSchema = external_exports.array(external_exports.string()).default([]).transform((arr) => {
  const out = [];
  for (const raw of arr) {
    const t = normalizeTag(raw);
    if (!t) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}).refine((arr) => arr.every((t) => TAG_KEBAB_RE.test(t)), { message: "tags must be dash-connected (lowercase letters, digits, dots, hyphens)" });
var contributors = external_exports.array(
  external_exports.object({
    login: external_exports.string(),
    commit: external_exports.string().optional(),
    url: external_exports.string().url().optional(),
    class: external_exports.enum(["grammar", "correction", "addition"]).optional(),
    at: external_exports.string().optional()
    // SOW-059: merge date (ISO); the payout collaboration gather windows on it
  })
).default([]);
var contentLinks = external_exports.array(
  external_exports.object({
    type: external_exports.enum(["homepage", "repository", "mirror", "download", "documentation", "support"]),
    url: external_exports.string().url(),
    label: external_exports.string().optional(),
    visibility: external_exports.enum(["public", "members"]).default("public"),
    primary: external_exports.boolean().default(false),
    encrypted: external_exports.boolean().default(false)
    // SOW-015: url is an AES-256-GCM .enc ciphertext; client-decrypted for paid members
  })
).default([]);
var socialLinks = external_exports.object({
  github: external_exports.string().optional(),
  website: external_exports.string().optional(),
  x: external_exports.string().optional(),
  bluesky: external_exports.string().optional(),
  youtube: external_exports.string().optional(),
  devto: external_exports.string().optional(),
  reddit: external_exports.string().optional(),
  mastodon: external_exports.string().optional(),
  linkedin: external_exports.string().optional(),
  discord: external_exports.string().optional(),
  // SOW-129: the comprehensive set (kept in sync with src/content.config.ts).
  instagram: external_exports.string().optional(),
  threads: external_exports.string().optional(),
  tiktok: external_exports.string().optional(),
  twitch: external_exports.string().optional(),
  facebook: external_exports.string().optional(),
  dailydev: external_exports.string().optional(),
  producthunt: external_exports.string().optional(),
  rumble: external_exports.string().optional(),
  // SOW-131: audio, publishing, dev, and creator platforms (kept in sync with src/content.config.ts).
  soundcloud: external_exports.string().optional(),
  mixcloud: external_exports.string().optional(),
  spotify: external_exports.string().optional(),
  bandcamp: external_exports.string().optional(),
  wordpress: external_exports.string().optional(),
  substack: external_exports.string().optional(),
  medium: external_exports.string().optional(),
  hashnode: external_exports.string().optional(),
  peerlist: external_exports.string().optional(),
  gitlab: external_exports.string().optional(),
  stackoverflow: external_exports.string().optional(),
  patreon: external_exports.string().optional(),
  kofi: external_exports.string().optional(),
  telegram: external_exports.string().optional()
}).partial();
var postSchema = external_exports.object({
  type: external_exports.literal("post").default("post"),
  title: external_exports.string(),
  slug: external_exports.string().regex(/^[a-z0-9-]+$/, "kebab-case, globally unique -> /articles/<slug>/"),
  author: external_exports.string(),
  contributors,
  status: STATUS.default("draft"),
  visibility: VISIBILITY.default("public"),
  publicStub: external_exports.boolean().default(false),
  // SOW-016
  encryptedBody: external_exports.string().optional(),
  // SOW-016: set by the publish flow (encrypt-on-publish), not hand-authored
  publishedAt: external_exports.coerce.date().optional(),
  updatedAt: external_exports.coerce.date().optional(),
  excerpt: external_exports.string().max(200).optional(),
  categories: external_exports.array(external_exports.string()).default([]),
  tags: tagsSchema,
  // sow-179/sow-183: mirrors src/content.config.ts's layout field exactly, including the 'journal' default
  // (see that file's comment; every already-published post carries its own explicit layout: 'journal').
  layout: external_exports.enum(["editorial", "journal", "card"]).default("journal"),
  coverImage: external_exports.string().optional(),
  coverAlt: external_exports.string().max(250).optional(),
  // SOW-062 P3: cover-image alt text (accessibility)
  video: external_exports.string().optional(),
  featured: external_exports.boolean().default(false),
  canonicalUrl: external_exports.string().url().optional(),
  redirectFrom: external_exports.array(external_exports.string()).default([])
});
var productSchema = external_exports.object({
  type: external_exports.literal("product").default("product"),
  title: external_exports.string(),
  slug: external_exports.string().regex(/^[a-z0-9-]+$/),
  author: external_exports.string(),
  contributors,
  status: STATUS.default("draft"),
  visibility: VISIBILITY.default("public"),
  publicStub: external_exports.boolean().default(false),
  // SOW-016
  encryptedBody: external_exports.string().optional(),
  // SOW-016: set by the publish flow (encrypt-on-publish)
  shortDescription: external_exports.string(),
  // Hierarchical category path into the canonical taxonomy (house/taxonomy.yml). Same shape as posts
  // so all content types share one taxonomy (SOW-012). Mirrors src/content.config.ts.
  categories: external_exports.array(external_exports.string()).default([]),
  tags: tagsSchema,
  platforms: external_exports.array(external_exports.string()).default([]),
  pricing: external_exports.enum(["free", "freemium", "paid"]).optional(),
  version: external_exports.string().optional(),
  pricingUrl: external_exports.string().url().optional(),
  icon: external_exports.string(),
  // REQUIRED, 1:1. The SMALL icon: the directory card renders it at 64 (shown 56).
  // Optional 1:1 LARGE icon for the detail page's 96px slot, which a 128px source cannot serve crisply at
  // 2x. Optional on purpose: every existing product predates it, and their 128x128 sources cannot be
  // upscaled into a genuine large asset. The render falls back to `icon`.
  iconLarge: external_exports.string().optional(),
  banner: external_exports.string().optional(),
  // sow-174: mirrors src/content.config.ts. Mutually exclusive with `banner` in the editor.
  bannerPreset: external_exports.enum(BANNER_PRESET_KEYS).optional(),
  featuredImage: external_exports.string(),
  // REQUIRED, mirrors src/content.config.ts (the 16:10 spotlight cover). Was optional
  // here: a product published without it passed the client but broke the Astro build (SOW-025, same drift class).
  // sow-172/174: a gallery entry is EITHER a bare path OR { src, caption }. Mirrors src/content.config.ts.
  // The union matters beyond validation: zod STRIPS unknown keys, so without it a caption would silently
  // vanish the next time this schema validated a save.
  gallery: external_exports.array(external_exports.union([external_exports.string(), external_exports.object({ src: external_exports.string(), caption: external_exports.string().optional() })])).default([]),
  galleryStyle: external_exports.enum(["grid", "carousel"]).optional(),
  // sow-172: unset resolves by shot count
  video: external_exports.string().optional(),
  links: contentLinks,
  // Mirrors src/content.config.ts. Which side the Contents rail renders on for this product's detail page.
  sidebarPosition: external_exports.enum(["left", "right"]).default("right"),
  publishedAt: external_exports.coerce.date().optional(),
  redirectFrom: external_exports.array(external_exports.string()).default([])
});
var profileSchema = external_exports.object({
  type: external_exports.literal("profile").default("profile"),
  username: external_exports.string(),
  displayName: external_exports.string(),
  tier: external_exports.enum(["trial", "paid"]).default("trial"),
  // SYSTEM-MANAGED (SOW-002)
  directory: external_exports.boolean().default(false),
  status: STATUS.default("published"),
  visibility: VISIBILITY.default("public"),
  headline: external_exports.string().optional(),
  avatar: external_exports.string().optional(),
  location: external_exports.string().optional(),
  forHire: external_exports.boolean().default(false),
  roles: external_exports.array(external_exports.string()).default([]),
  skills: external_exports.array(external_exports.string()).default([]),
  links: socialLinks.optional(),
  joinedAt: external_exports.coerce.date().optional()
  // system-set
});
var promptSchema = external_exports.object({
  type: external_exports.literal("prompt").default("prompt"),
  title: external_exports.string(),
  slug: external_exports.string().regex(/^[a-z0-9-]+$/),
  shortDescription: external_exports.string(),
  // REQUIRED, mirrors src/content.config.ts (one-line blurb on cards + the feed).
  // Was missing from this mirror: a prompt published without it passed the client but broke the Astro build (SOW-025).
  author: external_exports.string(),
  contributors,
  status: STATUS.default("draft"),
  visibility: VISIBILITY.default("public"),
  publicStub: external_exports.boolean().default(false),
  // SOW-016
  encryptedBody: external_exports.string().optional(),
  // SOW-016: set by the publish flow (encrypt-on-publish)
  targets: external_exports.array(external_exports.string()).default([]),
  // Hierarchical category path into the canonical taxonomy (house/taxonomy.yml). Same shape as posts
  // so all content types share one taxonomy (SOW-012). Mirrors src/content.config.ts.
  categories: external_exports.array(external_exports.string()).default([]),
  tags: tagsSchema,
  variables: external_exports.array(external_exports.string()).default([]),
  exampleOutput: external_exports.string().optional(),
  sourceUrl: external_exports.string().url().optional(),
  pricing: external_exports.enum(["free", "freemium", "paid"]).optional(),
  links: contentLinks,
  // An optional result image (a repo path string, like coverImage/icon). Only meaningful for image
  // generators: a prompt may carry an `image` ONLY when one of its `targets` is an image-gen model.
  // Recommended ratio 4:3 (e.g. 1200x900); the directory grid card crops the lead to 4:3.
  image: external_exports.string().optional(),
  publishedAt: external_exports.coerce.date().optional(),
  updatedAt: external_exports.coerce.date().optional(),
  redirectFrom: external_exports.array(external_exports.string()).default([])
}).superRefine((data, ctx) => {
  if (data.image && !isImageGenTarget(data.targets)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["image"],
      message: "an image is only allowed when a target is an image-gen model (e.g. Nano Banana, MidJourney)"
    });
  }
});
var shareSchema = external_exports.object({
  type: external_exports.literal("share").default("share"),
  id: external_exports.string().min(1),
  author: external_exports.string(),
  status: STATUS.default("draft"),
  visibility: VISIBILITY.default("members"),
  // Shares default to the members-only stream
  publicStub: external_exports.boolean().default(false),
  // SOW-016 consistency
  encryptedBody: external_exports.string().optional(),
  // SOW-016: set by the publish flow (encrypt-on-publish) for a members Share
  title: external_exports.string().optional(),
  shortDescription: external_exports.string().max(200).optional(),
  // SOW-032: optional one-line blurb (mirrors src/content.config.ts)
  url: external_exports.string().url().optional(),
  image: external_exports.string().optional(),
  // SOW-057: the featured image (an absolute OG URL or a repo-relative path)
  category: external_exports.string().optional(),
  // SOW-087: one flat topic key (house/topics.yml); routes the share's category Discord post
  tags: tagsSchema,
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date().optional()
});
var commentSchema = external_exports.object({
  type: external_exports.literal("comment").default("comment"),
  id: external_exports.string().min(1),
  author: external_exports.string(),
  targetType: external_exports.enum(["post", "product", "prompt", "share", "news"]),
  // SOW-032: 'share'; SOW-046 D: 'news' discussion
  targetSlug: external_exports.string(),
  // a share comment targets "<author>/<shareId>"; a news comment targets "news-<hash of guid>"
  status: STATUS.default("published"),
  visibility: VISIBILITY.default("members"),
  // SOW-044: members-only + encrypted by default; only a from-the-author intro (authorNote) on a post/product/prompt may be public
  authorNote: external_exports.boolean().default(false),
  // the deliberate "From the author" note (pinned), vs an ordinary comment
  encryptedBody: external_exports.string().optional(),
  // SOW-016: a members comment encrypts its body to this .enc
  parentId: external_exports.string().optional(),
  // threaded reply (still one file each)
  createdAt: external_exports.coerce.date(),
  updatedAt: external_exports.coerce.date().optional()
});
var SCHEMAS = Object.freeze({
  post: postSchema,
  product: productSchema,
  profile: profileSchema,
  prompt: promptSchema
});
var AUTHORABLE_TYPES = Object.freeze(["post", "product", "prompt", "profile"]);
var SYSTEM_MANAGED = Object.freeze({
  post: ["contributors"],
  product: ["contributors"],
  prompt: ["contributors"],
  profile: ["tier", "joinedAt"]
});
function schemaFor(type) {
  return SCHEMAS[type] ?? null;
}

// client/src/member-content.mjs
var MemberContentLockedError = class extends Error {
  constructor(message = "member content is locked (an active paid membership is required)") {
    super(message);
    this.name = "MemberContentLockedError";
  }
};
var base = (signupBase) => String(signupBase || "").replace(/\/$/, "");
async function decryptViaWorker({ envelope, token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new MemberContentLockedError("not signed in");
  const res = await fetch2(base(signupBase) + "/membership/decrypt", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(envelope)
  });
  if (res.status === 401 || res.status === 403) throw new MemberContentLockedError();
  if (!res.ok) throw new Error("decrypt failed (" + res.status + ")");
  const data = await res.json();
  if (!data || data.ok !== true || typeof data.text !== "string") throw new Error("decrypt: malformed response");
  return data.text;
}
async function encryptViaWorker({ plaintext, assetId, token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new MemberContentLockedError("not signed in");
  const res = await fetch2(base(signupBase) + "/membership/encrypt", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ plaintext, assetId })
  });
  if (res.status === 401 || res.status === 403) throw new MemberContentLockedError("cannot encrypt: an active paid membership is required");
  if (!res.ok) throw new Error("encrypt failed (" + res.status + ")");
  const data = await res.json();
  if (!data || data.ok !== true || !data.envelope) throw new Error("encrypt: malformed response");
  return data.envelope;
}
var MEMBER_MARKER = "<!-- members-only -->";
function splitMemberMarkdown(body) {
  const text = String(body ?? "");
  const idx = text.indexOf(MEMBER_MARKER);
  if (idx === -1) return { publicPart: text, memberPart: null };
  return {
    publicPart: text.slice(0, idx).trimEnd(),
    memberPart: text.slice(idx + MEMBER_MARKER.length).replace(/^\s+/, "")
  };
}
function encAssetFor(type, username, slug, scope = "member") {
  const assetId = `${type}:${slug}:body`;
  const folder = scope === "house" ? "house" : `members/${username}`;
  const path = `${folder}/_enc/${type}-${slug}-body.enc`;
  return { assetId, path };
}

// client/src/url-normalize.mjs
var TRACKING_KEYS = /* @__PURE__ */ new Set([
  "si",
  // YouTube per-share attribution token (the reported case)
  "fbclid",
  // Facebook click id
  "gclid",
  // Google Ads click id
  "igshid",
  // Instagram share id
  "mc_cid",
  // Mailchimp campaign id
  "mc_eid",
  // Mailchimp recipient id
  "ab_channel"
  // YouTube channel-attribution on a watch url
]);
var TRACKING_PREFIXES = ["utm_"];
function isTrackingKey(key) {
  const k = String(key).toLowerCase();
  if (TRACKING_KEYS.has(k)) return true;
  return TRACKING_PREFIXES.some((p) => k.startsWith(p));
}
function stripTrackingParams(input) {
  const s = String(input ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return s;
  let u;
  try {
    u = new URL(s);
  } catch {
    return s;
  }
  let changed = false;
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingKey(key)) {
      u.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return s;
  const qs2 = u.searchParams.toString();
  u.search = qs2 ? `?${qs2}` : "";
  return u.toString();
}

// client/src/content-ops.mjs
var SUBDIR = Object.freeze({ post: "posts", product: "products", prompt: "prompts" });
var MAX_BODY_BYTES = 1e6;
var NETWORK_CONTENT_OWNER = "gbtilabs";
function resolveTarget({ scope = "member", username } = {}) {
  if (scope === "house") return { scope: "house", folder: `members/${NETWORK_CONTENT_OWNER}`, author: NETWORK_CONTENT_OWNER };
  if (!username) throw new Error("resolveTarget: username is required for the member scope");
  return { scope: "member", folder: `members/${username}`, author: username };
}
function contentPath(type, username, slug, scope = "member") {
  if (type === "profile") {
    if (!username) throw new Error("contentPath: username is required");
    return `members/${username}/profile.md`;
  }
  const sub = SUBDIR[type];
  if (!sub) throw new Error(`contentPath: unknown type ${type}`);
  if (!slug) throw new Error(`contentPath: ${type} requires a slug`);
  const { folder } = resolveTarget({ scope, username });
  return `${folder}/${sub}/${slug}/index.md`;
}
function sanitizeInput(type, input, username, { author } = {}) {
  const out = { ...input ?? {} };
  for (const field of SYSTEM_MANAGED[type] ?? []) delete out[field];
  out.type = type;
  if (type === "profile") out.username = username;
  else out.author = author || username;
  return out;
}
var ContentValidationError = class extends Error {
  constructor(type, issues) {
    const detail = issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    super(`invalid ${type}: ${detail}`);
    this.name = "ContentValidationError";
    this.contentType = type;
    this.issues = issues;
  }
};
function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== void 0) out[k] = v;
  return out;
}
function buildContentFile({ type, username, input, body = "", scope = "member" }) {
  if (!AUTHORABLE_TYPES.includes(type)) throw new Error(`buildContentFile: ${type} is not an authorable type`);
  const target = resolveTarget({ scope, username });
  if (scope !== "house" && !username) throw new Error("buildContentFile: username is required");
  const schema = schemaFor(type);
  const cleaned = sanitizeInput(type, input, username, { author: target.author });
  const result = schema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError(type, result.error.issues);
  const bodyStr = String(body ?? "").trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError(type, [{ path: ["body"], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }
  const slug = type === "profile" ? null : cleaned.slug;
  const path = contentPath(type, username, slug, scope);
  const frontmatter = stripUndefined(cleaned);
  if (result.data && Array.isArray(result.data.tags) && "tags" in frontmatter) frontmatter.tags = result.data.tags;
  if (Array.isArray(frontmatter.tags) && !frontmatter.tags.length) delete frontmatter.tags;
  const markdown = serializeContentFile(frontmatter, body);
  return { path, frontmatter, markdown, type, username, slug, scope };
}
function shareId(createdAt, title) {
  const ts = String(createdAt ?? "").replace(/[^0-9]/g, "").slice(0, 14);
  const slug = String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const stamp = ts || "00000000000000";
  return slug ? `${stamp}-${slug}` : `${stamp}-share`;
}
function retagContent(text, { tag, to = null } = {}) {
  const { frontmatter, body } = parseContentFile(text);
  const fm = { ...frontmatter ?? {} };
  const tags = Array.isArray(fm.tags) ? fm.tags.map((t) => String(t)) : [];
  const target = String(tag).toLowerCase();
  if (!tags.some((t) => t.toLowerCase() === target)) return { changed: false, content: text };
  let next = tags.filter((t) => t.toLowerCase() !== target);
  if (to && !next.some((t) => t.toLowerCase() === String(to).toLowerCase())) next.push(String(to));
  fm.tags = next;
  if (!next.length) delete fm.tags;
  return { changed: true, content: serializeContentFile(fm, body) };
}
function flipContentStatus(text, status) {
  const { frontmatter, body } = parseContentFile(text);
  const current = frontmatter?.status ?? null;
  if (current === status) return { changed: false, current, content: null };
  const updated = { ...frontmatter ?? {}, status };
  const content = `---
${index_vite_proxy_tmp_default.dump(updated, { lineWidth: 100, noRefs: true }).trimEnd()}
---

${String(body).trim()}
`;
  return { changed: true, current, content };
}
function buildShareFile({ username, input, body = "" }) {
  if (!username) throw new Error("buildShareFile: username is required");
  const cleaned = stripUndefined({ status: "published", ...input ?? {}, type: "share", author: username });
  if (typeof cleaned.url === "string") cleaned.url = stripTrackingParams(cleaned.url);
  const result = shareSchema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError("share", result.error.issues);
  const id = cleaned.id;
  const bodyStr = String(body ?? "").trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError("share", [{ path: ["body"], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }
  const path = `members/${username}/shares/${id}.md`;
  const markdown = serializeContentFile(cleaned, body);
  return { path, frontmatter: cleaned, markdown, type: "share", username, slug: id, id };
}
function shareSummary(relPath, frontmatter = {}, body = "") {
  const fm = frontmatter || {};
  const isPublic = fm.visibility !== "members";
  let createdAt = null;
  if (fm.createdAt != null) {
    const d = fm.createdAt instanceof Date ? fm.createdAt : new Date(fm.createdAt);
    createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return {
    path: relPath,
    id: fm.id ?? null,
    author: fm.author ?? null,
    title: fm.title ?? null,
    shortDescription: fm.shortDescription ?? null,
    // SOW-032
    url: fm.url ?? null,
    image: typeof fm.image === "string" && fm.image.trim() ? fm.image.trim() : null,
    // SOW-057: featured image
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    visibility: fm.visibility ?? "members",
    status: fm.status ?? null,
    encryptedBody: typeof fm.encryptedBody === "string" ? fm.encryptedBody : null,
    createdAt,
    body: isPublic ? String(body ?? "") : ""
    // members body is gated; never surfaced here
  };
}
function commentSummary(relPath, frontmatter = {}, body = "") {
  const fm = frontmatter || {};
  const isPublic = fm.visibility !== "members";
  let createdAt = null;
  if (fm.createdAt != null) {
    const d = fm.createdAt instanceof Date ? fm.createdAt : new Date(fm.createdAt);
    createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return {
    path: relPath,
    id: fm.id ?? null,
    author: fm.author ?? null,
    targetType: fm.targetType ?? null,
    targetSlug: fm.targetSlug ?? null,
    parentId: fm.parentId ?? null,
    authorNote: fm.authorNote === true,
    visibility: fm.visibility ?? "public",
    status: fm.status ?? null,
    encryptedBody: typeof fm.encryptedBody === "string" ? fm.encryptedBody : null,
    createdAt,
    body: isPublic ? String(body ?? "") : ""
    // members body is gated; decrypted client-side via the Worker
  };
}
function byCommentOldest(a, b) {
  const t = String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? ""));
  if (t !== 0) return t;
  return String(a?.id ?? a?.path ?? "").localeCompare(String(b?.id ?? b?.path ?? ""));
}
function byShareNewest(a, b) {
  const t = String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""));
  if (t !== 0) return t;
  return String(b?.id ?? b?.path ?? "").localeCompare(String(a?.id ?? a?.path ?? ""));
}
function commentId(createdAt, suffix) {
  const ts = String(createdAt ?? "").replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  const s = String(suffix ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8) || "c";
  return `${ts}-${s}`;
}
function buildCommentFile({ username, input, body = "", scope = "member" } = {}) {
  if (!username) throw new Error("buildCommentFile: username is required");
  const target = resolveTarget({ scope, username });
  const cleaned = stripUndefined({ ...input ?? {}, type: "comment", author: target.author });
  const result = commentSchema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError("comment", result.error.issues);
  const id = cleaned.id;
  const bodyStr = String(body ?? "").trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError("comment", [{ path: ["body"], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }
  const path = `${target.folder}/comments/${id}.md`;
  const markdown = serializeContentFile(cleaned, body);
  return { path, frontmatter: cleaned, markdown, type: "comment", username, slug: id, id, scope: target.scope };
}
function serializeContentFile(frontmatter, body) {
  const front = index_vite_proxy_tmp_default.dump(stripUndefined(frontmatter), { lineWidth: 100, noRefs: true }).trimEnd();
  return `---
${front}
---

${String(body ?? "").trim()}
`;
}
function parseContentFile(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(text ?? ""));
  if (!m) return { frontmatter: {}, body: String(text ?? "") };
  return { frontmatter: index_vite_proxy_tmp_default.load(m[1]) ?? {}, body: (m[2] ?? "").replace(/^\n+/, "") };
}

// src/lib/content-index.mjs
var READ_PATH_RE = /^(members\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|house)\/(posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/;
function isReadablePath(path) {
  return typeof path === "string" && !path.includes("..") && !path.includes("\\") && READ_PATH_RE.test(path);
}

// client/src/github-reader.mjs
var SUBDIR2 = Object.freeze({ post: "posts", product: "products", prompt: "prompts" });
var TYPES = ["post", "product", "prompt", "profile"];
var SHARE_PATH = /^members\/[^/]+\/shares\/[^/]+\.(md|mdx)$/;
var COMMENT_PATH = /^(members\/[^/]+|house)\/comments\/[^/]+\.(md|mdx)$/;
var basename = (p) => p.slice(p.lastIndexOf("/") + 1);
function decodeBase64Utf8(b64) {
  const clean5 = String(b64 || "").replace(/\s/g, "");
  const bytes = Uint8Array.from(atob(clean5), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function safeRel(relPath) {
  return typeof relPath === "string" && relPath.length > 0 && !relPath.includes("..") && !relPath.includes("\\") && !relPath.startsWith("/");
}
function createGithubReader({ upstream, token, ref = "HEAD", fetch: fetch2 = globalThis.fetch, onAuthError, devlog: devlog2 = () => {
} } = {}) {
  const [owner, repo] = String(upstream || "").split("/");
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let signaled = false;
  async function ghFetch(url2) {
    const res = await fetch2(url2, { headers });
    if (!res.ok) devlog2("reader", "github read not ok", { status: res.status, url: url2, hadToken: !!token });
    if (res.status === 401 && token && onAuthError && !signaled) {
      signaled = true;
      devlog2("reader", "onAuthError: token rejected, clearing session", { url: url2 });
      try {
        onAuthError();
      } catch {
      }
    }
    return res;
  }
  async function contents(relPath) {
    const url2 = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(relPath)}?ref=${encodeURIComponent(ref)}`;
    const res = await ghFetch(url2);
    if (!res.ok) return null;
    return res.json();
  }
  async function tree() {
    const url2 = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const res = await ghFetch(url2);
    if (!res.ok) return null;
    return res.json();
  }
  async function readFile(relPath) {
    if (!owner || !repo || !safeRel(relPath)) return null;
    const j = await contents(relPath);
    if (!j || Array.isArray(j) || j.type !== "file" || typeof j.content !== "string") return null;
    return decodeBase64Utf8(j.content);
  }
  async function get(username, relPath) {
    if (!username || typeof relPath !== "string") return null;
    if (relPath.includes("..") || relPath.includes("\\") || !relPath.startsWith(`members/${username}/`)) return null;
    const text = await readFile(relPath);
    if (text == null) return null;
    const { frontmatter, body } = parseContentFile(text);
    return { path: relPath, frontmatter, body };
  }
  function summarize(relPath, frontmatter) {
    const pubMs = frontmatter.publishedAt ? new Date(frontmatter.publishedAt).getTime() : NaN;
    const updMs = frontmatter.updatedAt ? new Date(frontmatter.updatedAt).getTime() : NaN;
    return {
      path: relPath,
      type: frontmatter.type ?? null,
      title: frontmatter.title ?? frontmatter.displayName ?? relPath,
      slug: frontmatter.slug ?? null,
      status: frontmatter.status ?? null,
      visibility: frontmatter.visibility ?? null,
      publishedAt: Number.isFinite(pubMs) ? pubMs : null,
      updatedAt: Number.isFinite(updMs) ? updMs : null
    };
  }
  async function listType(username, type, scope = "member") {
    const houseScope = scope === "house";
    if (type === "profile") {
      if (houseScope) return [];
      const rel = `members/${username}/profile.md`;
      const text = await readFile(rel);
      if (text == null) return [];
      return [summarize(rel, parseContentFile(text).frontmatter)];
    }
    const sub = SUBDIR2[type];
    if (!sub) return [];
    const base3 = houseScope ? `house/${sub}` : `members/${username}/${sub}`;
    const dir = await contents(base3);
    if (!Array.isArray(dir)) return [];
    const out = [];
    for (const entry of dir) {
      if (entry.type !== "dir") continue;
      const rel = `${base3}/${entry.name}/index.md`;
      const text = await readFile(rel);
      if (text != null) out.push(summarize(rel, parseContentFile(text).frontmatter));
    }
    return out;
  }
  return {
    readFile,
    get,
    // SOW-031: read ANY member's or house's PUBLISHED content index.md for the in-extension reader. Unlike
    // get() (own-folder-scoped for editing), this is read-only over the public repo, gated by a strict
    // allowlist (only posts/products/prompts index.md, no traversal, no roles.yml / house/pages) so the member
    // token cannot become a general file-exfil oracle. Member-only BODIES are not here: the public teaser comes
    // back as `body`, and frontmatter.encryptedBody points at the .enc the reader decrypts via the Worker.
    async read(relPath) {
      if (!isReadablePath(relPath)) return null;
      const text = await readFile(relPath);
      if (text == null) return null;
      const { frontmatter, body } = parseContentFile(text);
      return { path: relPath, frontmatter, body };
    },
    async list(username, type, scope = "member") {
      if (scope !== "house" && !username) return [];
      if (type) return listType(username, type, scope);
      const all = [];
      for (const t of TYPES) all.push(...await listType(username, t, scope));
      return all;
    },
    /** Browsing ALL members-only content over the Contents API is too many calls for the live overlay; the npm
     * host portal (local working copy) is the surface for that. Deferred: returns []. */
    async listMembersOnly() {
      return [];
    },
    /**
     * SOW-018: list PUBLISHED Shares across ALL members for the extension Shares feed. ONE recursive Git Trees
     * call enumerates every members/<u>/shares/<id>.md path; because the Share id is a timestamp-slug, sorting
     * by the FILENAME yields newest-first, so we read only the newest `limit` files (bounded API calls), filter
     * drafts, and re-sort by createdAt. A members Share's plaintext is NOT read here (the stub body is empty;
     * its .enc is decrypted client-side via the Worker).
     */
    async listShares(limit = 40) {
      if (!owner || !repo) return [];
      const t = await tree();
      if (!t || !Array.isArray(t.tree)) return [];
      const paths = t.tree.filter((e) => e && e.type === "blob" && typeof e.path === "string" && SHARE_PATH.test(e.path)).map((e) => e.path).sort((a, b) => basename(b).localeCompare(basename(a)));
      const cap = Math.max(0, limit);
      const out = [];
      for (const rel of paths) {
        if (out.length >= cap) break;
        const text = await readFile(rel);
        if (text == null) continue;
        const { frontmatter, body } = parseContentFile(text);
        if ((frontmatter?.status ?? "published") !== "published") continue;
        out.push(shareSummary(rel, frontmatter, body));
      }
      out.sort(byShareNewest);
      return out.slice(0, cap);
    },
    /**
     * SOW-032: list PUBLISHED comments for a Share's discussion. ONE recursive Git Trees call enumerates every
     * members/<u>/comments/<id>.md + house/comments/<id>.md; we read the newest `limit` by filename (timestamp
     * stem -> newest first), keep published `targetType:'share'` comments whose targetSlug matches, and return
     * them OLDEST-first (a conversation reads top-down). A members comment's plaintext is NOT read here; its .enc
     * is decrypted client-side via the Worker, exactly like a members Share body.
     */
    // SOW-041: the generic comment-thread reader for ANY content type; listShareComments is a thin alias.
    async listShareComments(targetSlug, limit = 100) {
      return this.listComments("share", targetSlug, limit);
    },
    async listComments(targetType, targetSlug, limit = 100, aliases = []) {
      if (!owner || !repo || !targetType || !targetSlug) return [];
      const slugs = /* @__PURE__ */ new Set([targetSlug, ...Array.isArray(aliases) ? aliases : []]);
      const t = await tree();
      if (!t || !Array.isArray(t.tree)) return [];
      const paths = t.tree.filter((e) => e && e.type === "blob" && typeof e.path === "string" && COMMENT_PATH.test(e.path)).map((e) => e.path).sort((a, b) => basename(b).localeCompare(basename(a)));
      const cap = Math.max(0, limit);
      const out = [];
      for (const rel of paths) {
        if (out.length >= cap) break;
        const text = await readFile(rel);
        if (text == null) continue;
        const { frontmatter, body } = parseContentFile(text);
        if ((frontmatter?.status ?? "published") !== "published") continue;
        if (frontmatter?.targetType !== targetType || !slugs.has(frontmatter?.targetSlug)) continue;
        out.push(commentSummary(rel, frontmatter, body));
      }
      out.sort(byCommentOldest);
      return out.slice(0, cap);
    }
  };
}

// client/src/signup-base.mjs
var SIGNUP_BASE = globalThis.process?.env?.GBTI_SIGNUP_BASE || "https://signup.gbti.network";
var GITHUB_CLIENT_ID = globalThis.process?.env?.GBTI_GITHUB_CLIENT_ID || "Ov23limR5x7taIm33sTY";
var GITHUB_APP_CLIENT_ID = "Iv23lis8jbx62zI7cwE8";
var GITHUB_APP_SLUG = "gbti-network-publisher";
var UPSTREAM_REPO = globalThis.process?.env?.GBTI_UPSTREAM_REPO || "gbti-network/gbti.network";
var rawAuthMode = "app";
var AUTH_MODE = rawAuthMode === "app" ? "app" : rawAuthMode === "hosted" ? "hosted" : "classic";
var isAppMode = () => AUTH_MODE === "app";
var activeClientId = () => AUTH_MODE === "classic" ? GITHUB_CLIENT_ID : GITHUB_APP_CLIENT_ID;
var activeScope = () => AUTH_MODE === "classic" ? "public_repo read:user" : "";
function authModeFor(ctxOrStore) {
  const store = ctxOrStore?.store ?? ctxOrStore;
  const stored = store?.get?.("authMode");
  return stored === "app" || stored === "hosted" || stored === "classic" ? stored : AUTH_MODE;
}
var isHostedCtx = (ctxOrStore) => authModeFor(ctxOrStore) === "hosted";
function decideAuthMode(probe) {
  if (!probe?.reachedGithub || !probe?.signedIn) return null;
  if (probe.forkReady && probe.installReady) return "app";
  if (!probe.forkReady) return "hosted";
  return null;
}

// client/src/github-repo.mjs
var GitHubError = class extends Error {
  constructor(status, body) {
    super(`github error ${status}: ${body}`);
    this.name = "GitHubError";
    this.status = status;
    this.body = body;
  }
};
function toBase64(text) {
  const s = String(text);
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function fromBase64(b64) {
  const clean5 = String(b64 || "").replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") return Buffer.from(clean5, "base64").toString("utf8");
  const bin = atob(clean5);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function interpretGateState(state) {
  switch (state) {
    case "success":
      return "mergeable";
    case "pending":
      return "checking";
    case "failure":
      return "held";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}
function createRepoClient({ token, upstream, fetch: fetch2 = globalThis.fetch, baseUrl = "https://api.github.com", appMode = isAppMode(), signupBase = SIGNUP_BASE }) {
  if (!token) throw new Error("createRepoClient: token is required");
  if (!upstream) throw new Error('createRepoClient: upstream ("owner/name") is required');
  const GATE_CONTEXT = "membership-gate";
  async function req(method, path, body) {
    const res = await fetch2(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gbti-network-client",
        ...body ? { "Content-Type": "application/json" } : {}
      },
      body: body ? JSON.stringify(body) : void 0
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new GitHubError(res.status, text);
    return text ? JSON.parse(text) : null;
  }
  async function callWorker(method, path, body) {
    const res = await fetch2(`${String(signupBase).replace(/\/$/, "")}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...body ? { "Content-Type": "application/json" } : {} },
      ...body ? { body: JSON.stringify(body) } : {}
    });
    const text = await res.text();
    if (!res.ok) throw new GitHubError(res.status, text);
    return text ? JSON.parse(text) : {};
  }
  return {
    _req: req,
    upstream,
    /** The authenticated user ({ login, id }) from the device-flow token. */
    async getAuthUser() {
      const u = await req("GET", "/user");
      return { login: u.login, id: String(u.id) };
    },
    /** Ensure the member has a fork of upstream. Classic: POST /forks (idempotent, returns the existing fork).
     *  App mode (SOW-026): VERIFY the fork exists (the fork-scoped token cannot create it; the member forks via
     *  the web UI in the onboarding wizard). A missing fork means setup is incomplete. */
    async ensureFork() {
      if (appMode) {
        const me = await req("GET", "/user");
        const full = `${String(me.login).toLowerCase()}/${upstream.split("/")[1]}`;
        let r;
        try {
          r = await req("GET", `/repos/${full}`);
        } catch (err) {
          if (err instanceof GitHubError && err.status === 404) {
            throw new GitHubError(404, "no fork found. Finish setup in the GBTI extension (make your copy of the network), then publish again.");
          }
          throw err;
        }
        if (!r.fork) throw new GitHubError(409, `${full} is not a fork of ${upstream}; rename it and make your copy from the extension.`);
        return { full_name: r.full_name, owner: r.owner?.login, default_branch: r.default_branch };
      }
      const f2 = await req("POST", `/repos/${upstream}/forks`);
      return { full_name: f2.full_name, owner: f2.owner?.login, default_branch: f2.default_branch };
    },
    /** Upstream's default branch name (e.g. "main"). */
    async getDefaultBranch(repoFullName = upstream) {
      const r = await req("GET", `/repos/${repoFullName}`);
      return r.default_branch;
    },
    /** The head commit SHA of a branch on a repo. */
    async getBranchSha(repoFullName, branch) {
      const r = await req("GET", `/repos/${repoFullName}/git/ref/heads/${encodeURIComponent(branch)}`);
      return r.object?.sha;
    },
    /** Force-move a branch ref to sha (used ONLY to reset a leftover publish branch with no open PR). */
    async forceBranch(repoFullName, branch, sha) {
      await req("PATCH", `/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: true });
    },
    /** Create the branch if absent (from fromSha). A 422 (already exists) is treated as success. */
    async ensureBranch(repoFullName, branch, fromSha) {
      try {
        await req("POST", `/repos/${repoFullName}/git/refs`, { ref: `refs/heads/${branch}`, sha: fromSha });
      } catch (err) {
        if (err instanceof GitHubError && err.status === 422) return;
        throw err;
      }
    },
    /** The blob SHA of a file on a branch, or null when it does not exist yet (needed to UPDATE vs CREATE). */
    async getFileSha(repoFullName, path, ref) {
      try {
        const r = await req("GET", `/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(ref)}`);
        return Array.isArray(r) ? null : r.sha ?? null;
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
        throw err;
      }
    },
    /** Create or update a file on a branch (Contents API). content is base64. */
    async putFile(repoFullName, path, { message, contentBase64, branch, sha }) {
      return req("PUT", `/repos/${repoFullName}/contents/${path}`, {
        message,
        content: contentBase64,
        branch,
        ...sha ? { sha } : {}
      });
    },
    /** Delete a file on a branch (Contents API DELETE; needs the current blob sha). */
    async deleteFile(repoFullName, path, { message, branch, sha }) {
      return req("DELETE", `/repos/${repoFullName}/contents/${path}`, { message, branch, sha });
    },
    /** Open a PR upstream. head is "forkOwner:branch". Classic: POST directly with the member token. App mode
     *  (SOW-026): delegate to the Worker (the fork-scoped token cannot open a PR into the canonical repo); the
     *  Worker opens it with GBTI's App installation and dedups an existing PR (returns { already: true }). */
    async openPull({ title, head, base: base3, body }) {
      if (appMode) {
        const p2 = await callWorker("POST", "/membership/open-pr", { title, head, base: base3, body });
        return { number: p2.number ?? null, html_url: p2.html_url ?? null, already: p2.already === true };
      }
      const p = await req("POST", `/repos/${upstream}/pulls`, { title, head, base: base3, body });
      return { number: p.number, html_url: p.html_url };
    },
    /** Find an OPEN upstream PR for a given head ("forkOwner:branch"), or null. App mode (SOW-026): the
     *  fork-scoped token cannot read the upstream, so skip the check and let the Worker dedup on open. */
    async findOpenPull({ head }) {
      if (appMode) return null;
      const list = await req("GET", `/repos/${upstream}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=1`);
      const p = list?.[0];
      return p ? { number: p.number, html_url: p.html_url } : null;
    },
    /** A member's PRs upstream, with title + number + url + state + merged. SOW-033 P4: returns OPEN *and*
     *  recently-updated CLOSED/MERGED PRs (newest activity first, capped) so the workspace can show Accepted
     *  (merged) and Declined (closed) in addition to Proposed/Needs-changes. App mode (SOW-026): the fork-scoped
     *  token cannot read the upstream + the PRs are opened by GBTI's App, so the Worker lists them scoped to the
     *  member's fork (and likewise returns state + merged). The `author:`/head-owner scoping is unchanged: a
     *  member only ever sees their own PRs. */
    async listMyPulls(login) {
      if (appMode) {
        const p = await callWorker("GET", "/membership/my-pulls");
        return p.items ?? [];
      }
      const q = encodeURIComponent(`repo:${upstream} type:pr author:${login}`);
      const r = await req("GET", `/search/issues?q=${q}&sort=updated&order=desc&per_page=100`);
      return (r.items ?? []).map((i) => ({
        number: i.number,
        title: i.title,
        html_url: i.html_url,
        state: i.state ?? "open",
        merged: Boolean(i.pull_request?.merged_at)
      }));
    },
    /** Open upstream PRs ({ number, title, html_url, author:{login,id}, headSha, createdAt, updatedAt }), newest
     *  first. SOW-028: the owner's contribution inbox lists these and keeps only the PRs whose files fall
     *  entirely inside the owner's folder. App mode (SOW-026): the fork-scoped token cannot read the upstream, so
     *  the Worker lists them (GBTI's App installation); classic reads the upstream directly. */
    async listOpenPulls() {
      if (appMode) {
        const p = await callWorker("GET", "/membership/open-pulls");
        return p.items ?? [];
      }
      const list = await req("GET", `/repos/${upstream}/pulls?state=open&sort=created&direction=desc&per_page=100`);
      return (list ?? []).map((p) => ({
        number: p.number,
        title: p.title,
        html_url: p.html_url,
        author: { login: p.user?.login ?? null, id: p.user?.id != null ? String(p.user.id) : null },
        headSha: p.head?.sha ?? null,
        createdAt: p.created_at ?? null,
        updatedAt: p.updated_at ?? null
      }));
    },
    /** The changed files of a PR ([{ filename, status, additions, deletions }]). SOW-028: used to scope an open
     *  PR to the owner's folder (the inbox filter) and to render the diff. App mode (SOW-026): the Worker reads
     *  the upstream files; classic reads them directly. */
    async listPullFiles(prNumber) {
      if (appMode) {
        const p = await callWorker("GET", `/membership/pr-files?number=${encodeURIComponent(prNumber)}`);
        return p.files ?? [];
      }
      const files = await req("GET", `/repos/${upstream}/pulls/${prNumber}/files?per_page=100`);
      return (files ?? []).map((f2) => ({
        filename: f2.filename,
        status: f2.status,
        additions: f2.additions ?? 0,
        deletions: f2.deletions ?? 0
      }));
    },
    /** The gate status for a PR: { state, meaning, sha }. App mode (SOW-026): the Worker reads the upstream PR +
     *  combined status with GBTI's App installation, scoped to the member's own PR. Classic reads it directly. */
    async gateStatus(prNumber) {
      if (appMode) {
        const p = await callWorker("GET", `/membership/pr-status?number=${encodeURIComponent(prNumber)}`);
        return { state: p.state ?? "unknown", meaning: p.meaning ?? "unknown", sha: p.sha ?? null, description: p.description };
      }
      const pr = await req("GET", `/repos/${upstream}/pulls/${prNumber}`);
      const sha = pr.head?.sha;
      if (!sha) return { state: "unknown", meaning: "unknown", sha: null };
      const status = await req("GET", `/repos/${upstream}/commits/${sha}/status`);
      const gate = (status.statuses ?? []).find((s) => s.context === GATE_CONTEXT);
      const state = gate?.state ?? status.state ?? "unknown";
      return { state, meaning: interpretGateState(state), sha, description: gate?.description };
    },
    // ----- SOW-028 P2/P3: the owner-side contribution review (read one PR, render its diff, decide) -----
    /** One PR's review metadata: { number, title, body, html_url, state, headSha, author:{login,id} }. App mode
     *  (SOW-026): the Worker reads it with GBTI's installation; classic reads the upstream directly. */
    async getPull(prNumber) {
      if (appMode) return callWorker("GET", `/membership/pr?number=${encodeURIComponent(prNumber)}`);
      const p = await req("GET", `/repos/${upstream}/pulls/${prNumber}`);
      return {
        number: p.number,
        title: p.title,
        body: p.body ?? "",
        html_url: p.html_url,
        state: p.state,
        headSha: p.head?.sha ?? null,
        author: { login: p.user?.login ?? null, id: p.user?.id != null ? String(p.user.id) : null }
      };
    },
    /** A PR's changed files WITH the unified `patch` for the diff view ([{ filename, status, additions,
     *  deletions, patch }]). Heavier than listPullFiles (which omits patch for the inbox list). */
    async getPullDiffFiles(prNumber) {
      if (appMode) {
        const p = await callWorker("GET", `/membership/pr-files?number=${encodeURIComponent(prNumber)}&patch=1`);
        return p.files ?? [];
      }
      const files = await req("GET", `/repos/${upstream}/pulls/${prNumber}/files?per_page=100`);
      return (files ?? []).map((f2) => ({
        filename: f2.filename,
        status: f2.status,
        additions: f2.additions ?? 0,
        deletions: f2.deletions ?? 0,
        patch: f2.patch ?? null
      }));
    },
    /** The decoded text of a file at a ref (the PR head SHA), or null if it does not exist there (a removed file).
     *  Used to render the "preview as merged" view of the proposed content. */
    async getFileContent(path, ref) {
      if (appMode) {
        const p = await callWorker("GET", `/membership/file?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`);
        return p.text ?? null;
      }
      try {
        const r = await req("GET", `/repos/${upstream}/contents/${path}?ref=${encodeURIComponent(ref)}`);
        if (Array.isArray(r) || !r?.content) return null;
        return fromBase64(r.content);
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
        throw err;
      }
    },
    // ----- SOW-082: fork-staged draft I/O. A draft is a per-item branch gbti/<type>-<slug> on the member's FORK
    // with NO open PR. All three operate DIRECTLY on the fork in both classic and app mode (the fork is the
    // member's own repo; the app-mode fork-scoped token can read+write+delete it), so none need a Worker proxy. -----
    /** List branch refs on a repo matching `heads/<prefix>` (GET git/matching-refs). Used to enumerate a member's
     *  fork-staged draft branches (prefix 'gbti/'). Returns [{ branch, sha }]; an empty/absent set -> []. */
    async listMatchingRefs(repoFullName, prefix) {
      try {
        const r = await req("GET", `/repos/${repoFullName}/git/matching-refs/heads/${prefix}`);
        return (Array.isArray(r) ? r : []).map((x) => ({ branch: String(x.ref || "").replace(/^refs\/heads\//, ""), sha: x.object?.sha ?? null }));
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return [];
        throw err;
      }
    },
    /** Delete a branch ref on a repo (DELETE git/refs/heads). Used to discard a fork-staged draft. The branch is
     *  NOT URL-encoded: the slashes in `heads/gbti/<slug>` are real path separators in the git-refs API. */
    async deleteBranch(repoFullName, branch) {
      return req("DELETE", `/repos/${repoFullName}/git/refs/heads/${branch}`);
    },
    /** The decoded text of a file at a ref on a SPECIFIC repo (the member's fork), or null if absent. Unlike
     *  getFileContent (which targets the upstream / Worker), this reads the fork directly with the member token. */
    async getForkFileContent(repoFullName, path, ref) {
      try {
        const r = await req("GET", `/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(ref)}`);
        if (Array.isArray(r) || !r?.content) return null;
        return fromBase64(r.content);
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
        throw err;
      }
    },
    /** Submit a PR review as the signed-in owner (CLASSIC mode only). The gate honors an APPROVE only when
     *  commit_id is the current head SHA (a later push invalidates a stale approval), so the caller passes the
     *  freshly-read headSha. There is deliberately no app-mode proxy: a fork-scoped token cannot post to the
     *  upstream, and the installation token would author as GBTI's app (which the gate must not trust as a
     *  universal approver), so in app mode the owner approves on github.com (operations guards this). */
    async submitReview(prNumber, { event, body = "", commitId } = {}) {
      return req("POST", `/repos/${upstream}/pulls/${prNumber}/reviews`, { event, body, ...commitId ? { commit_id: commitId } : {} });
    },
    /** Close a PR without merging. Best-effort: a non-collaborator owner cannot close another member's PR, so the
     *  caller treats a failure as non-fatal (the declining review still stands). Classic mode only. */
    async closePull(prNumber) {
      return req("PATCH", `/repos/${upstream}/pulls/${prNumber}`, { state: "closed" });
    }
  };
}

// client/src/roles.mjs
var ROLE = Object.freeze({ member: "member", moderator: "moderator", admin: "admin", superadmin: "superadmin" });
var RANK = Object.freeze({ member: 0, moderator: 1, admin: 2, superadmin: 3 });
function rolesFromParsed(parsed) {
  const map2 = /* @__PURE__ */ new Map();
  const assign = (list, role) => {
    for (const e of list ?? []) {
      const id = String(e?.github_id ?? e);
      if (id && id !== "REPLACE_AT_M0") map2.set(id, role);
    }
  };
  assign(parsed?.moderators, ROLE.moderator);
  assign(parsed?.admins, ROLE.admin);
  assign(parsed?.superadmins, ROLE.superadmin);
  return map2;
}
function roleOf(githubId, rolesMap) {
  return rolesMap.get(String(githubId)) ?? ROLE.member;
}
function rank(role) {
  return RANK[role] ?? 0;
}
function rolesFromText(text) {
  if (!text) return /* @__PURE__ */ new Map();
  try {
    return rolesFromParsed(index_vite_proxy_tmp_default.load(text));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
var canModerate = (role) => rank(role) >= RANK.moderator;
var canBanGrandfather = (role) => rank(role) >= RANK.admin;
var canManageRoles = (role) => rank(role) >= RANK.superadmin;
function curatorsFromText(text) {
  const set2 = /* @__PURE__ */ new Set();
  if (!text) return set2;
  try {
    const parsed = index_vite_proxy_tmp_default.load(text);
    for (const e of parsed?.curators ?? []) {
      const id = String(e?.github_id ?? e);
      if (id && id !== "REPLACE_AT_M0") set2.add(id);
    }
  } catch {
  }
  return set2;
}
var canCurateNews = (role, isCurator) => rank(role) >= RANK.admin || isCurator === true;

// client/src/membership.mjs
var STAFF = /* @__PURE__ */ new Set([ROLE.moderator, ROLE.admin, ROLE.superadmin]);
var NON_PUBLISHABLE = /* @__PURE__ */ new Set(["trialing", "expired", "cancelled", "none", "banned"]);
function bannedIdsFromText(text) {
  if (!text) return /* @__PURE__ */ new Set();
  try {
    const parsed = index_vite_proxy_tmp_default.load(text);
    return new Set((parsed?.bans ?? []).map((e) => String(e?.github_id ?? e)).filter(Boolean));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function grandfathersFromText(text) {
  if (!text) return /* @__PURE__ */ new Map();
  try {
    const parsed = index_vite_proxy_tmp_default.load(text);
    const m = /* @__PURE__ */ new Map();
    for (const e of parsed?.grandfathered ?? []) {
      const id = String(e?.github_id ?? e);
      if (id) m.set(id, e);
    }
    return m;
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function grandfatherActive(entry, now = Date.now()) {
  if (!entry) return false;
  const until = entry.until;
  if (until === void 0 || until === null || until === "") return true;
  const t = new Date(until).getTime();
  if (Number.isNaN(t)) return false;
  return now < t;
}
function effectiveMembership({ githubId, stripeStatus = "unknown", roles = /* @__PURE__ */ new Map(), banned = /* @__PURE__ */ new Set(), grandfathers = /* @__PURE__ */ new Map(), now = Date.now() } = {}) {
  const id = String(githubId ?? "");
  if (banned.has(id)) return "banned";
  if (STAFF.has(roleOf(id, roles))) return "paid";
  if (grandfatherActive(grandfathers.get(id), now)) return "paid";
  return stripeStatus || "unknown";
}
var STAGE_TIER = /* @__PURE__ */ new Set(["paid", "trialing"]);
function canStageDrafts(membership) {
  return STAGE_TIER.has(membership);
}
var READ_TIER = /* @__PURE__ */ new Set(["paid", "trialing", "expired", "cancelled", "none", "banned"]);
var FREE_TIER = /* @__PURE__ */ new Set(["paid", "trialing", "expired", "cancelled", "none"]);
function canBrowse(membership) {
  return READ_TIER.has(membership);
}
function canSeeNews(membership) {
  return READ_TIER.has(membership);
}
var SEE_SHARES_TIER = /* @__PURE__ */ new Set(["paid", "trialing"]);
function canSeeShares(membership) {
  return SEE_SHARES_TIER.has(membership);
}
function canFollow(membership) {
  return FREE_TIER.has(membership);
}
function canSave(membership) {
  return FREE_TIER.has(membership);
}
function isBlockedFromPublishing(membership) {
  return NON_PUBLISHABLE.has(membership);
}
async function fetchStripeStatus({ token, signupBase, fetch: fetch2 = globalThis.fetch } = {}) {
  if (!token || !signupBase) return { status: "unknown", couponUntil: null, paidTier: "none" };
  try {
    const res = await fetch2(`${String(signupBase).replace(/\/$/, "")}/membership/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return { status: "unknown", couponUntil: null, paidTier: "none" };
    const data = await res.json();
    return { status: data?.status ?? "unknown", couponUntil: data?.couponUntil ?? null, paidTier: typeof data?.paidTier === "string" ? data.paidTier : "none" };
  } catch {
    return { status: "unknown", couponUntil: null, paidTier: "none" };
  }
}
async function readSafe(readFile, p) {
  if (typeof readFile !== "function") return null;
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}
async function resolveMembership({ githubId, token, signupBase, readFile, fetch: fetch2 = globalThis.fetch, now = Date.now() } = {}) {
  const { status: stripeStatus, couponUntil: workerCouponUntil, paidTier: workerPaidTier } = await fetchStripeStatus({ token, signupBase, fetch: fetch2 });
  const roles = rolesFromText(await readSafe(readFile, "house/roles.yml"));
  const banned = bannedIdsFromText(await readSafe(readFile, "house/bans.yml"));
  const grandfathers = grandfathersFromText(await readSafe(readFile, "house/grandfathered.yml"));
  const membership = effectiveMembership({ githubId, stripeStatus, roles, banned, grandfathers, now });
  let couponUntil = membership === "banned" ? null : workerCouponUntil ?? null;
  if (!couponUntil && membership === "paid" && stripeStatus !== "paid") {
    const entry = grandfathers.get(String(githubId));
    if (entry?.until && String(entry.reason ?? "").startsWith("coupon:")) {
      const until = new Date(entry.until);
      if (!Number.isNaN(until.getTime()) && now < until.getTime()) couponUntil = until.toISOString();
    }
  }
  const paidTier = membership === "banned" ? "none" : workerPaidTier ?? "none";
  return { stripeStatus, membership, couponUntil, paidTier };
}

// membership/devlog-core.mjs
var SECRET_KEY = /token|secret|authorization|bearer|password|refresh|api[_-]?key|cookie|credential|client[_-]?secret/i;
var MAX_STRING = 200;
var MAX_DEPTH = 3;
function clip(s) {
  const str = String(s);
  return str.length > MAX_STRING ? `${str.slice(0, MAX_STRING)}…(${str.length})` : str;
}
function redactDeep(value, depth = 0) {
  if (value == null) return value;
  const t = typeof value;
  if (t === "string") return clip(value);
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return `${value}n`;
  if (t === "function") return `[fn ${value.name || "anonymous"}]`;
  if (t !== "object") return String(value);
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[array(${value.length})]` : "[object]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactDeep(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) {
      out[k] = v == null || v === "" ? "<empty>" : "<redacted>";
      continue;
    }
    out[k] = redactDeep(v, depth + 1);
  }
  return out;
}
function isOn(enabled) {
  try {
    return typeof enabled === "function" ? !!enabled() : !!enabled;
  } catch {
    return false;
  }
}
function createDevlog({ enabled = false, sink = console, now = Date.now, ringSize = 200 } = {}) {
  let gate = enabled;
  const ring = [];
  const emit = typeof sink === "function" ? sink : sink && typeof sink.log === "function" ? (...a) => sink.log(...a) : () => {
  };
  const devlog2 = (area, msg, data) => {
    if (!isOn(gate)) return;
    const t = now();
    const safe = data === void 0 ? void 0 : redactDeep(data);
    const entry = { t, area: String(area || "app"), msg: String(msg == null ? "" : msg) };
    if (safe !== void 0) entry.data = safe;
    ring.push(entry);
    if (ring.length > ringSize) ring.splice(0, ring.length - ringSize);
    try {
      safe === void 0 ? emit(`[gbti:${entry.area}] ${entry.msg}`) : emit(`[gbti:${entry.area}] ${entry.msg}`, safe);
    } catch {
    }
  };
  devlog2.recent = () => ring.slice();
  devlog2.clear = () => {
    ring.length = 0;
  };
  devlog2.setEnabled = (next) => {
    gate = next;
  };
  devlog2.enabled = () => isOn(gate);
  return devlog2;
}

// extension/src/devlog.mjs
var DEVLOG_FLAG_KEY = "gbti-devlog";
var FLAG = false;
try {
  chrome?.storage?.local?.get?.(DEVLOG_FLAG_KEY)?.then?.((r) => {
    FLAG = r?.[DEVLOG_FLAG_KEY] === true;
  })?.catch?.(() => {
  });
  chrome?.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === "local" && changes?.[DEVLOG_FLAG_KEY]) FLAG = changes[DEVLOG_FLAG_KEY].newValue === true;
  });
} catch {
}
function devlogFlagOn() {
  return FLAG === true;
}
var devlog = createDevlog({ enabled: devlogFlagOn, sink: console });

// extension/src/ext-context.mjs
var UPSTREAM = "gbti-network/gbti.network";
function buildExtContext(store) {
  const token = store.get("githubToken");
  let authExpired = false;
  let membershipFlight = null;
  const onAuthError = () => {
    authExpired = true;
    store.set({ githubToken: null, githubRefreshToken: null, githubTokenExpiresAt: null, identity: null });
  };
  return {
    store,
    devlog,
    // SOW-124: the background realm's devlog (superadmin + flag gated; a strict no-op otherwise)
    reader: createGithubReader({ upstream: UPSTREAM, token, onAuthError, devlog }),
    authExpired: () => authExpired,
    getRepoClient() {
      const t = store.get("githubToken");
      return t ? createRepoClient({ token: t, upstream: UPSTREAM, appMode: authModeFor(store) !== "classic" }) : null;
    },
    identity() {
      const id = store.get("identity");
      if (!id) return null;
      return { login: id.login, githubId: id.githubId, username: (id.username || id.login || "").toLowerCase() };
    },
    /** SOW-011: the effective membership cached at login (paid/trialing/...). Gates publish + the UI notice. */
    membership() {
      return store.get("membership") ?? "unknown";
    },
    /** SOW-119 QA: the coupon-grant end date (ISO) cached at login/resolution; null when the paid status
     *  is not coupon-sourced. Drives the extension expiry countdown. */
    couponUntil() {
      return store.get("couponUntil") ?? null;
    },
    /** sow-185: the resolved paid TIER (none|member|creator) cached at resolution. Presentation-only (the
     *  real creator gate is authorizeCreator server-side); drives the page signal + any creator-tier UI.
     *  Fail-closed to 'none' when unresolved, matching the Worker's own default. */
    paidTier() {
      return store.get("paidTier") ?? "none";
    },
    /** SOW-089 fix: membership was resolved ONLY at login, so one failed resolution left the session
     *  'unknown' FOREVER and every fail-closed gate (member comment bodies, the members-only thread,
     *  shares) locked a paid member out until a re-login. This self-heals: an unknown cache with a live
     *  token re-resolves via the oracle + house overrides, caches, and returns; failures stay 'unknown'
     *  (fail-closed). In-flight dedupe keeps a render burst to one resolution. */
    async membershipResolved() {
      const cached2 = store.get("membership");
      if (cached2 && cached2 !== "unknown") {
        devlog("membership", "resolved from cache", { membership: cached2 });
        return cached2;
      }
      const t = store.get("githubToken");
      const id = store.get("identity");
      if (!t || !id?.githubId) {
        devlog("membership", "unknown: no token or identity", { hasToken: !!t, hasId: !!id?.githubId });
        return "unknown";
      }
      if (!membershipFlight) {
        devlog("membership", "resolving via oracle + house overrides");
        membershipFlight = resolveMembership({ githubId: String(id.githubId), token: t, signupBase: SIGNUP_BASE, readFile: (p) => this.reader.readFile(p) }).then(({ stripeStatus, membership, couponUntil, paidTier }) => {
          store.set({ stripeStatus, membership, couponUntil: couponUntil ?? null, paidTier: paidTier ?? "none" });
          devlog("membership", "resolved", { stripeStatus, membership: membership ?? "unknown" });
          return membership ?? "unknown";
        }).catch((e) => {
          devlog("membership", "resolve failed, fail-closed to unknown", { error: e?.message });
          return "unknown";
        }).finally(() => {
          membershipFlight = null;
        });
      }
      return membershipFlight;
    }
  };
}

// client/src/publish.mjs
function branchName(type, slug, scope = "member") {
  if (type === "profile") return "gbti/profile";
  const prefix = scope === "house" ? "gbti/house-" : "gbti/";
  return `${prefix}${type}-${slug}`;
}
function defaultMessage(change) {
  return change.type === "profile" ? "Update profile" : `${change.slug ? "Update" : "Add"} ${change.type}: ${change.slug ?? ""}`.trim();
}
function defaultTitle(change) {
  return change.type === "profile" ? `Update ${change.username}'s profile` : `${change.type}: ${change.slug}`;
}
async function commitToBranchOnFork({ repo, branch, files, message, resetStale = false, clobberOpenPull = false }) {
  if (!branch) throw new Error("commitToBranchOnFork: a branch name is required");
  if (!Array.isArray(files) || files.length === 0) throw new Error("commitToBranchOnFork: at least one file change is required");
  const fork = await repo.ensureFork();
  const base3 = await repo.getDefaultBranch(repo.upstream);
  const baseSha = await repo.getBranchSha(fork.full_name, base3);
  if (resetStale && repo.findOpenPull && repo.forceBranch) {
    let tip = null;
    try {
      tip = await repo.getBranchSha(fork.full_name, branch);
    } catch {
      tip = null;
    }
    if (tip && tip !== baseSha) {
      const open = clobberOpenPull ? null : await repo.findOpenPull({ head: `${fork.owner}:${branch}` });
      if (!open) await repo.forceBranch(fork.full_name, branch, baseSha);
    }
  }
  await repo.ensureBranch(fork.full_name, branch, baseSha);
  for (const f2 of files) {
    const existingSha = await repo.getFileSha(fork.full_name, f2.path, branch);
    if (f2.content === null) {
      if (existingSha) await repo.deleteFile(fork.full_name, f2.path, { message: message ?? `Remove ${f2.path}`, branch, sha: existingSha });
    } else {
      await repo.putFile(fork.full_name, f2.path, {
        message: message ?? `Update ${f2.path}`,
        contentBase64: toBase64(f2.content),
        branch,
        sha: existingSha ?? void 0
      });
    }
  }
  return { fork: fork.full_name, owner: fork.owner, branch, base: base3 };
}
async function publishContent({ repo, change, message, title, body }) {
  if (!change?.path || !change?.markdown) throw new Error("publishContent: a built content change is required");
  const branch = branchName(change.type, change.slug, change.scope);
  const { fork, owner, base: base3 } = await commitToBranchOnFork({
    repo,
    branch,
    files: [{ path: change.path, content: change.markdown }],
    message: message ?? defaultMessage(change),
    resetStale: true
    // a leftover branch from a merged PR must not seed a conflicting new PR
  });
  const head = `${owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) {
    return { prNumber: existing.number, prUrl: existing.html_url, branch, fork, updated: true };
  }
  const pull = await repo.openPull({ title: title ?? defaultTitle(change), head, base: base3, body: body ?? "" });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, fork, updated: false };
}
async function publishFiles({ repo, branch, files, message, title, body, clobberOpenPull = false }) {
  if (!branch) throw new Error("publishFiles: a branch name is required");
  if (!Array.isArray(files) || files.length === 0) throw new Error("publishFiles: at least one file change is required");
  const { fork, owner, base: base3 } = await commitToBranchOnFork({ repo, branch, files, message, resetStale: true, clobberOpenPull });
  const head = `${owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) return { prNumber: existing.number, prUrl: existing.html_url, branch, fork, updated: true };
  const pull = await repo.openPull({ title: title ?? message ?? "Update", head, base: base3, body: body ?? "" });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, fork, updated: false };
}

// client/src/member-activity-client.mjs
var trimBase = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var ActivityClientError = class extends Error {
};
async function call(method, body, { token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new ActivityClientError("not signed in");
  const res = await fetch2(trimBase(signupBase) + "/membership/activity", {
    method,
    headers: { Authorization: "Bearer " + token, ...body ? { "Content-Type": "application/json" } : {} },
    ...body ? { body: JSON.stringify(body) } : {}
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new ActivityClientError(data?.message || data?.error || `activity request failed (${res.status})`);
  return data;
}
async function getActivity(opts) {
  return call("GET", null, opts);
}
async function setFavorite({ targetType, targetSlug, on = true, ...opts }) {
  return call("POST", { action: "favorite", type: targetType, slug: targetSlug, on }, opts);
}
async function createCollection({ name, ...opts }) {
  return call("POST", { action: "collection.create", name }, opts);
}
async function renameCollection({ id, name, ...opts }) {
  return call("POST", { action: "collection.rename", id, name }, opts);
}
async function deleteCollection({ id, ...opts }) {
  return call("POST", { action: "collection.delete", id }, opts);
}
async function setCollectionItem({ id, targetType, targetSlug, on = true, ...opts }) {
  return call("POST", { action: "collection.item", id, type: targetType, slug: targetSlug, on }, opts);
}

// client/src/member-earnings-client.mjs
var trimBase2 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var EarningsClientError = class extends Error {
};
async function getEarnings({ token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new EarningsClientError("not signed in");
  const res = await fetch2(trimBase2(signupBase) + "/membership/earnings", {
    headers: { Authorization: "Bearer " + token }
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new EarningsClientError(data?.message || data?.error || `earnings request failed (${res.status})`);
  return data;
}

// client/src/member-comment-echo-client.mjs
var trimBase3 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var CommentEchoClientError = class extends Error {
};
async function call2(method, path, body, { token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new CommentEchoClientError("not signed in");
  const res = await fetch2(trimBase3(signupBase) + "/membership/comment-echo" + path, {
    method,
    headers: { Authorization: "Bearer " + token, ...body ? { "Content-Type": "application/json" } : {} },
    ...body ? { body: JSON.stringify(body) } : {}
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new CommentEchoClientError(data?.message || data?.error || `comment-echo request failed (${res.status})`);
  return data;
}
async function getCommentEchoes({ targetType, targetSlug, ...opts }) {
  const q = `?targetType=${encodeURIComponent(targetType)}&targetSlug=${encodeURIComponent(targetSlug)}`;
  return call2("GET", q, null, opts);
}
async function addCommentEcho({ echo, ...opts }) {
  return call2("POST", "", { action: "add", echo }, opts);
}
async function reapCommentEchoes({ targetType, targetSlug, ids, ...opts }) {
  return call2("POST", "", { action: "reap", targetType, targetSlug, ids }, opts);
}

// membership/comment-echo.mjs
var byTime = (a, b) => String(a?.createdAt || a?.postedAt || "").localeCompare(String(b?.createdAt || b?.postedAt || ""));
function mergeCommentEchoes({ deployed = [], echoes = [], prState = () => "unknown" } = {}) {
  const deployedIds = new Set((Array.isArray(deployed) ? deployed : []).map((c) => c && c.id).filter(Boolean));
  const reap = [];
  const pending = /* @__PURE__ */ new Set();
  const kept = [];
  const seenEcho = /* @__PURE__ */ new Set();
  for (const e of Array.isArray(echoes) ? echoes : []) {
    if (!e || !e.id || seenEcho.has(e.id)) continue;
    seenEcho.add(e.id);
    if (deployedIds.has(e.id)) {
      reap.push(e.id);
      continue;
    }
    if (prState(e.prNumber) === "closed") {
      reap.push(e.id);
      continue;
    }
    kept.push({ ...e, _pending: true });
    pending.add(e.id);
  }
  const comments = [...Array.isArray(deployed) ? deployed : [], ...kept].sort(byTime);
  return { comments, reap, pending };
}

// client/src/member-follows-client.mjs
var trimBase4 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var FollowsClientError = class extends Error {
};
async function call3(method, body, { token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new FollowsClientError("not signed in");
  const res = await fetch2(trimBase4(signupBase) + "/membership/follows", {
    method,
    headers: { Authorization: "Bearer " + token, ...body ? { "Content-Type": "application/json" } : {} },
    ...body ? { body: JSON.stringify(body) } : {}
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new FollowsClientError(data?.message || data?.error || `follows request failed (${res.status})`);
  return data;
}
async function getFollows(opts) {
  return call3("GET", null, opts);
}
async function setFollow({ username, on = true, ...opts }) {
  return call3("POST", { username, on }, opts);
}

// client/src/member-upvote-client.mjs
var trimBase5 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var UpvoteClientError = class extends Error {
};
async function upvote({ type = "share", slug, on = true, token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new UpvoteClientError("not signed in");
  const res = await fetch2(trimBase5(signupBase) + "/membership/upvote", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ type, slug, on })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new UpvoteClientError(data?.message || data?.error || `upvote request failed (${res.status})`);
  return data;
}

// client/src/member-og-client.mjs
var trimBase6 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var OgClientError = class extends Error {
};
async function ogPreview({ url: url2, token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new OgClientError("not signed in");
  const res = await fetch2(trimBase6(signupBase) + "/membership/og-preview", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ url: url2 })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new OgClientError(data?.message || data?.error || `og-preview request failed (${res.status})`);
  return data;
}

// client/src/fork-sync-client.mjs
var trimBase7 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
async function workerSyncFork({ token, signupBase, fetch: fetch2 = globalThis.fetch, branch = "main" } = {}) {
  if (!token || !signupBase) return { ok: false, synced: false, reason: "not-signed-in" };
  try {
    const res = await fetch2(`${trimBase7(signupBase)}/membership/sync-fork`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch })
    });
    if (!res.ok) return { ok: false, synced: false, reason: `http-${res.status}` };
    const data = await res.json().catch(() => null);
    return data && typeof data === "object" ? data : { ok: false, synced: false, reason: "bad-response" };
  } catch {
    return { ok: false, synced: false, reason: "network" };
  }
}

// client/src/member-invite-client.mjs
var trimBase8 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var InviteClientError = class extends Error {
};
async function getDiscordInvite({ token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new InviteClientError("not signed in");
  const res = await fetch2(trimBase8(signupBase) + "/membership/discord-invite", {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new InviteClientError(data?.message || data?.error || `invite request failed (${res.status})`);
  return data;
}

// client/src/news-client.mjs
var NewsClientError = class extends Error {
};
var base2 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var qs = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
async function workerGetNews({ token, signupBase, fetch: fetch2 = globalThis.fetch, category, since, limit } = {}) {
  if (!token || !signupBase) throw new NewsClientError("not signed in");
  const res = await fetch2(`${base2(signupBase)}/membership/news${qs({ category, since, limit })}`, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError("news requires sign-in");
  if (!res.ok) throw new NewsClientError("news unavailable (" + res.status + ")");
  const data = await res.json();
  return { items: Array.isArray(data?.items) ? data.items : [], updatedAt: data?.updatedAt ?? null };
}
async function workerGetNewsSources({ token, signupBase, fetch: fetch2 = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new NewsClientError("not signed in");
  const res = await fetch2(`${base2(signupBase)}/membership/news-sources`, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError("news requires sign-in");
  if (!res.ok) throw new NewsClientError("news sources unavailable (" + res.status + ")");
  const data = await res.json();
  return { sources: Array.isArray(data?.sources) ? data.sources : [] };
}
async function workerGetPrefs({ token, signupBase, fetch: fetch2 = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new NewsClientError("not signed in");
  const res = await fetch2(`${base2(signupBase)}/membership/prefs`, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError("prefs require sign-in");
  if (!res.ok) throw new NewsClientError("prefs unavailable (" + res.status + ")");
  const data = await res.json();
  return data?.prefs ?? { categories: [], followedChannels: [] };
}
async function workerSetPrefs({ token, signupBase, fetch: fetch2 = globalThis.fetch, patch } = {}) {
  if (!token || !signupBase) throw new NewsClientError("not signed in");
  const res = await fetch2(`${base2(signupBase)}/membership/prefs`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(patch || {}) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError("prefs require sign-in");
  if (!res.ok) throw new NewsClientError("could not save prefs (" + res.status + ")");
  const data = await res.json();
  return data?.prefs ?? { categories: [], followedChannels: [] };
}
async function workerPublishNews({ token, signupBase, fetch: fetch2 = globalThis.fetch, item } = {}) {
  if (!token || !signupBase) throw new NewsClientError("not signed in");
  const guid3 = String(item?.guid || "").trim();
  if (!guid3) throw new NewsClientError("a news item is required");
  const payload = { guid: guid3, source: item?.source ?? "" };
  const res = await fetch2(`${base2(signupBase)}/membership/news-publish`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError("publishing to Discord requires a news curator role");
  if (!res.ok) throw new NewsClientError("could not publish to Discord (" + res.status + ")");
  return res.json();
}
async function workerNewsDiscussed({ token, signupBase, fetch: fetch2 = globalThis.fetch, guid: guid3 } = {}) {
  if (!token || !signupBase) throw new NewsClientError("not signed in");
  const g = String(guid3 || "").trim();
  if (!g) throw new NewsClientError("a news item is required");
  const res = await fetch2(`${base2(signupBase)}/membership/news-discussed`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ guid: g }) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError("news discussion requires a paid membership");
  if (!res.ok) throw new NewsClientError("could not reflect the discussion (" + res.status + ")");
  return res.json();
}
async function workerNewsOpened({ token, signupBase, fetch: fetch2 = globalThis.fetch, guid: guid3, source } = {}) {
  if (!token || !signupBase) throw new NewsClientError("not signed in");
  const g = String(guid3 || "").trim();
  if (!g) throw new NewsClientError("a news item is required");
  const res = await fetch2(`${base2(signupBase)}/membership/news-opened`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ guid: g, ...source ? { source: String(source) } : {} }) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError("not signed in");
  if (!res.ok) throw new NewsClientError("could not record the open (" + res.status + ")");
  return res.json();
}
async function workerContentOpened({ token, signupBase, fetch: fetch2 = globalThis.fetch, type, slug } = {}) {
  if (!token || !signupBase) throw new NewsClientError("not signed in");
  const t = String(type || "").trim();
  const s = String(slug || "").trim();
  if (!t || !s) throw new NewsClientError("a content type + slug is required");
  const res = await fetch2(`${base2(signupBase)}/membership/content-opened`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ type: t, slug: s }) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError("not signed in");
  if (!res.ok) throw new NewsClientError("could not record the open (" + res.status + ")");
  return res.json();
}

// client/src/github-app-probe.mjs
var GH = "https://api.github.com";
var ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "gbti-network", "If-None-Match": "" });
var ghInit = (token) => ({ headers: ghHeaders(token), cache: "no-store" });
var repoName = (login, upstream) => `${String(login).toLowerCase()}/${upstream.split("/")[1]}`;
async function getAuthedUser({ token, fetch: fetch2 = globalThis.fetch }) {
  const res = await fetch2(`${GH}/user`, ghInit(token));
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`github /user ${res.status}`);
  const u = await res.json();
  return { login: String(u.login), githubId: String(u.id) };
}
async function forkReady({ token, login, upstream, fetch: fetch2 = globalThis.fetch }) {
  const res = await fetch2(`${GH}/repos/${repoName(login, upstream)}`, ghInit(token));
  if (!res.ok) return false;
  const r = await res.json();
  return r.fork === true && String(r.parent?.full_name || "").toLowerCase() === upstream.toLowerCase();
}
async function appInstallStatus({ token, login, appSlug, upstream, fetch: fetch2 = globalThis.fetch }) {
  const fork = repoName(login, upstream);
  const res = await fetch2(`${GH}/user/installations`, ghInit(token));
  if (!res.ok) return { installed: false, allRepos: false };
  const data = await res.json();
  const insts = (data.installations || []).filter((i) => String(i.app_slug || "").toLowerCase() === appSlug.toLowerCase());
  const inst = insts.find((i) => String(i.account?.login || "").toLowerCase() === String(login).toLowerCase()) || insts[0];
  if (!inst) return { installed: false, allRepos: false };
  if (inst.repository_selection === "all") return { installed: false, allRepos: true };
  const rres = await fetch2(`${GH}/user/installations/${inst.id}/repositories?per_page=100`, ghInit(token));
  if (!rres.ok) return { installed: false, allRepos: false };
  const rd = await rres.json();
  const has = (rd.repositories || []).some((r) => String(r.full_name || "").toLowerCase() === fork);
  return { installed: has, allRepos: false };
}
async function probeReadiness({ token, appSlug, upstream, fetch: fetch2 = globalThis.fetch }) {
  if (!token) return { signedIn: false, forkReady: false, installReady: false, reachedGithub: true };
  let user;
  try {
    user = await getAuthedUser({ token, fetch: fetch2 });
  } catch {
    return { signedIn: false, forkReady: false, installReady: false, reachedGithub: false };
  }
  if (!user) return { signedIn: false, forkReady: false, installReady: false, reachedGithub: true };
  try {
    const fork = await forkReady({ token, login: user.login, upstream, fetch: fetch2 });
    let install = { installed: false, allRepos: false };
    if (fork) install = await appInstallStatus({ token, login: user.login, appSlug, upstream, fetch: fetch2 });
    return { signedIn: true, login: user.login, githubId: user.githubId, forkReady: fork, installReady: install.installed, allReposGrant: install.allRepos, reachedGithub: true };
  } catch {
    return { signedIn: true, login: user.login, githubId: user.githubId, forkReady: false, installReady: false, reachedGithub: false };
  }
}

// client/src/onboarding.mjs
function nextStep({ signedIn = false, forkReady: forkReady2 = false, installReady = false } = {}) {
  if (!signedIn) return "signin";
  if (!forkReady2) return "fork";
  if (!installReady) return "install";
  return "ready";
}
var deviceVerificationUrl = () => "https://github.com/login/device";
var forkUrl = () => `https://github.com/${UPSTREAM_REPO}/fork`;
var manageInstallsUrl = () => "https://github.com/settings/installations";
function appInstallUrl({ targetId } = {}) {
  const base3 = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;
  return targetId ? `${base3}?suggested_target_id=${encodeURIComponent(targetId)}` : base3;
}
var forkFullName = (login) => `${String(login || "").toLowerCase()}/${UPSTREAM_REPO.split("/")[1]}`;
var STEPS = {
  signin: {
    id: "signin",
    title: "Sign in with GitHub",
    why: "This connects the extension to your GitHub account so your posts publish under your name. We never see your password.",
    preview: "After you enter the code, GitHub shows an Authorize screen. The green Authorize button finishes sign-in.",
    button: "Sign in with GitHub",
    doneLabel: "Signed in"
  },
  fork: {
    id: "fork",
    title: "Make your copy of the network",
    why: "You write in your own copy first, then send it to GBTI for review. Nothing is public until it is approved.",
    preview: "GitHub opens a page with one green Create fork button. Click it and leave every option as-is.",
    button: "Make my copy on GitHub",
    doneLabel: "Your copy is ready"
  },
  install: {
    id: "install",
    title: "Give access to just your copy",
    why: "This lets the extension save your drafts into your copy and nothing else. You can remove it anytime in GitHub settings.",
    preview: "GitHub asks which repositories. Choose Only select repositories, pick gbti.network, then Install. Please do not pick All repositories.",
    button: "Give access on GitHub",
    doneLabel: "Access granted to your copy"
  }
};

// client/src/hosted-publish.mjs
function hostedItemId(type, slug) {
  return type === "profile" ? "profile" : `${type}-${slug}`;
}
function hostedPublishFiles(ctx, { branch, files, title }) {
  const itemId = String(branch || "").replace(/^gbti\//, "");
  return hostedAuthor({
    token: ctx.store?.get?.("githubToken"),
    itemId,
    files,
    title,
    signupBase: SIGNUP_BASE,
    fetchImpl: ctx.fetch ?? globalThis.fetch
  });
}
async function hostedAuthor({ token, itemId, files, title, signupBase = SIGNUP_BASE, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error("sign in to publish");
  const res = await fetchImpl(`${String(signupBase).replace(/\/$/, "")}/membership/author`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, files, title })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.message || `hosted publish failed (${res.status})`);
  return { prNumber: body.number, prUrl: body.html_url, branch: body.branch, fork: null, updated: !!body.already, hosted: true };
}

// client/src/drafts-client.mjs
var trimBase9 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var DraftsClientError = class extends Error {
};
async function call4(method, body, { token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new DraftsClientError("not signed in");
  const res = await fetch2(trimBase9(signupBase) + "/membership/drafts", {
    method,
    headers: { Authorization: "Bearer " + token, ...body ? { "Content-Type": "application/json" } : {} },
    ...body ? { body: JSON.stringify(body) } : {}
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new DraftsClientError(data?.message || data?.error || `drafts request failed (${res.status})`);
  return data;
}
async function workerListDrafts(opts) {
  return call4("GET", null, opts);
}
async function workerPutDraft({ draft, ...opts }) {
  return call4("POST", { op: "put", draft }, opts);
}
async function workerDeleteDraft({ type, slug, ...opts }) {
  return call4("POST", { op: "delete", type, slug }, opts);
}

// client/src/repo-drafts-client.mjs
var trimBase10 = (b) => String(b || "").replace(/\/$/, "");
var RepoDraftsClientError = class extends Error {
};
async function workerListRepoDrafts({ token, signupBase, fetch: fetch2 = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new RepoDraftsClientError("not signed in");
  const res = await fetch2(trimBase10(signupBase) + "/membership/repo-drafts", { headers: { Authorization: "Bearer " + token } });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new RepoDraftsClientError(data?.message || data?.error || `repo-drafts request failed (${res.status})`);
  return data;
}

// client/src/repo-drafts-core.mjs
function mapRepoDraftItem(item = {}) {
  const type = item?.type;
  const slug = item?.slug;
  return {
    type,
    slug,
    branch: null,
    path: typeof item?.path === "string" ? item.path : null,
    pendingSlug: null,
    title: typeof item?.title === "string" && item.title ? item.title : slug || type || "",
    visibility: item?.visibility === "members" ? "members" : "public",
    status: "draft",
    owner: item?.owner ?? null,
    valid: true,
    invalidReason: null,
    pull: null,
    store: "repo"
  };
}
function mergeRepoDrafts(existing = [], repoItems = [], { type = null } = {}) {
  const rows = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(rows.map((d) => `${d?.type}:${d?.slug}`));
  for (const item of Array.isArray(repoItems) ? repoItems : []) {
    if (!item || !item.type || !item.slug) continue;
    if (type && item.type !== type) continue;
    const key = `${item.type}:${item.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(mapRepoDraftItem(item));
  }
  return rows;
}

// membership/overrides-core.mjs
var ROLE2 = Object.freeze({
  member: "member",
  moderator: "moderator",
  admin: "admin",
  superadmin: "superadmin"
});
var PRIVILEGED_ROLES = /* @__PURE__ */ new Set([ROLE2.moderator, ROLE2.admin, ROLE2.superadmin]);
var ADMIN_ROLES = /* @__PURE__ */ new Set([ROLE2.admin, ROLE2.superadmin]);
function isPrivilegedRole(role) {
  return PRIVILEGED_ROLES.has(role);
}
function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}
var idOf = (entry) => String(entry?.github_id ?? entry);
function rolesFromParsed2(parsed) {
  const roles = /* @__PURE__ */ new Map();
  const assign = (list, role) => {
    for (const e of list ?? []) {
      const id = idOf(e);
      if (id && id !== "REPLACE_AT_M0") roles.set(id, role);
    }
  };
  assign(parsed?.moderators, ROLE2.moderator);
  assign(parsed?.admins, ROLE2.admin);
  assign(parsed?.superadmins, ROLE2.superadmin);
  return roles;
}
function roleLoginsFromParsed(parsed) {
  const logins = /* @__PURE__ */ new Map();
  const add = (list) => {
    for (const e of list ?? []) {
      const id = idOf(e);
      const login = e?.login != null && e.login !== "" ? String(e.login) : null;
      if (id && id !== "REPLACE_AT_M0" && login) logins.set(id, login);
    }
  };
  add(parsed?.moderators);
  add(parsed?.admins);
  add(parsed?.superadmins);
  return logins;
}
function bansFromParsed(parsed) {
  const bans = /* @__PURE__ */ new Map();
  for (const e of parsed?.bans ?? []) {
    const id = idOf(e);
    if (id) bans.set(id, e);
  }
  return bans;
}
function grandfathersFromParsed(parsed) {
  const grandfathers = /* @__PURE__ */ new Map();
  for (const e of parsed?.grandfathered ?? []) {
    const id = idOf(e);
    if (id) grandfathers.set(id, e);
  }
  return grandfathers;
}
function membersIndexFromParsed(parsed) {
  const index = /* @__PURE__ */ new Map();
  const members = parsed?.members ?? {};
  for (const [id, username] of Object.entries(members)) {
    if (id && username) index.set(String(id), String(username));
  }
  return index;
}
function roleOf2(githubId, roles) {
  return roles.get(String(githubId)) ?? ROLE2.member;
}
function isBanned(githubId, bans) {
  return bans.has(String(githubId));
}
function grandfatherActive2(githubId, grandfathers, now = /* @__PURE__ */ new Date()) {
  const entry = grandfathers.get(String(githubId));
  if (!entry) return false;
  const until = entry.until;
  if (until === void 0 || until === null || until === "") return true;
  const untilDate = new Date(until);
  if (Number.isNaN(untilDate.getTime())) return false;
  return now.getTime() < untilDate.getTime();
}
function effectiveStatus(githubId, derived, overrides, now = /* @__PURE__ */ new Date()) {
  const { bans, grandfathers, roles } = overrides;
  if (isBanned(githubId, bans)) return { status: "banned", source: "ban" };
  if (roles && isPrivilegedRole(roleOf2(githubId, roles))) return { status: "paid", source: "staff" };
  if (grandfatherActive2(githubId, grandfathers, now)) return { status: "paid", source: "grandfather" };
  return { status: derived, source: "stripe" };
}

// membership/tiers.mjs
var TIER = Object.freeze({
  none: "none",
  // not paid, or paid for something we cannot identify (see tierForPrice)
  member: "member",
  // Network Member: $5 monthly / $50 annual
  creator: "creator"
  // Content Creator: $15 monthly / $150 annual
});
var RANK2 = Object.freeze({ [TIER.none]: 0, [TIER.member]: 1, [TIER.creator]: 2 });

// membership/classify-pr.mjs
var CONTENT_DIRS = ["posts", "products", "prompts", "comments"];
var ROLE_RANK = { [ROLE2.member]: 0, [ROLE2.moderator]: 1, [ROLE2.admin]: 2, [ROLE2.superadmin]: 3 };
function isCleanPath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\\")) return false;
  if (p.includes("\0")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
function isContributionToFolder(paths, ownerFolder) {
  if (!ownerFolder || !Array.isArray(paths) || paths.length === 0) return false;
  const prefix = `members/${ownerFolder}/`;
  return paths.every((p) => {
    if (!isCleanPath(p) || !p.startsWith(prefix)) return false;
    return CONTENT_DIRS.includes(p.slice(prefix.length).split("/")[0]);
  });
}

// membership/superadmin-roster.mjs
function buildRoster({ roles, bans, grandfathered, membersIndex, stripeStatuses, stripeLogins } = {}, now = /* @__PURE__ */ new Date()) {
  const roleMap = rolesFromParsed2(roles);
  const roleLogins = roleLoginsFromParsed(roles);
  const banMap = bansFromParsed(bans);
  const gfMap = grandfathersFromParsed(grandfathered);
  const idx = membersIndexFromParsed(membersIndex);
  const stripe = stripeStatuses && typeof stripeStatuses === "object" ? stripeStatuses : {};
  const stripeLoginMap = stripeLogins && typeof stripeLogins === "object" ? stripeLogins : {};
  const overrides = { bans: banMap, grandfathers: gfMap, roles: roleMap };
  const ids = /* @__PURE__ */ new Set([...idx.keys(), ...roleMap.keys(), ...banMap.keys(), ...gfMap.keys(), ...Object.keys(stripe)]);
  const roster = [...ids].map((id) => {
    const derived = stripe[id] || "unknown";
    const eff = effectiveStatus(id, derived, overrides, now);
    const gf = gfMap.get(id);
    return {
      githubId: id,
      // SOW-091: resolve the display username through every known source before falling back to the raw id, so a
      // staff member (roles login) or a paid/trial member with no published content (Stripe github_login) is named.
      username: idx.get(id) || banMap.get(id)?.login || gf?.login || roleLogins.get(id) || stripeLoginMap[id] || null,
      role: roleOf2(id, roleMap),
      banned: isBanned(id, banMap),
      grandfathered: grandfatherActive2(id, gfMap, now),
      grandfatherUntil: gf?.until ?? null,
      stripeStatus: stripe[id] || null,
      // the raw Stripe-derived tier (null when the admin endpoint was not consulted)
      status: eff.status,
      // banned | paid | trialing | expired | cancelled | none | unknown
      source: eff.source
      // ban | staff | grandfather | stripe
    };
  });
  const band = (r) => r.role !== ROLE2.member ? 0 : r.grandfathered ? 1 : r.banned ? 2 : 3;
  roster.sort((a, b) => band(a) - band(b) || String(a.username || a.githubId).localeCompare(String(b.username || b.githubId)));
  const summary = {
    total: roster.length,
    staff: roster.filter((r) => r.role !== ROLE2.member).length,
    grandfathered: roster.filter((r) => r.grandfathered).length,
    banned: roster.filter((r) => r.banned).length,
    members: roster.filter((r) => r.role === ROLE2.member && !r.grandfathered && !r.banned).length
  };
  return { roster, summary };
}

// membership/member-activity.mjs
var CONTENT_TYPES = /* @__PURE__ */ new Set(["post", "product", "prompt", "share"]);
var MAX_NAME_LEN = 80;
var SLUG_RE = /^[a-z0-9-]+$/;
var SHARE_SLUG_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
var slugOk = (type, slug) => (type === "share" ? SHARE_SLUG_RE : SLUG_RE).test(slug);
function emptyActivity() {
  return { favorites: [], upvotes: [], collections: [], updatedAt: null };
}
function normalizeTargetList(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  const seen = /* @__PURE__ */ new Set();
  for (const f2 of raw) {
    if (!f2 || !isTarget(f2.type, f2.slug)) continue;
    const k = targetKey(f2);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type: f2.type, slug: f2.slug, addedAt: Number(f2.addedAt) || 0 });
  }
  return out;
}
var isTarget = (type, slug) => CONTENT_TYPES.has(type) && typeof slug === "string" && slugOk(type, slug);
var targetKey = (t) => `${t.type}:${t.slug}`;
function normalizeActivity(raw) {
  const a = emptyActivity();
  if (!raw || typeof raw !== "object") return a;
  a.favorites = normalizeTargetList(raw.favorites);
  a.upvotes = normalizeTargetList(raw.upvotes);
  if (Array.isArray(raw.collections)) {
    const seenIds = /* @__PURE__ */ new Set();
    for (const c of raw.collections) {
      if (!c || typeof c.id !== "string" || typeof c.name !== "string") continue;
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      const items = [];
      const seenItems = /* @__PURE__ */ new Set();
      if (Array.isArray(c.items)) {
        for (const it of c.items) {
          if (!it || !isTarget(it.type, it.slug)) continue;
          const k = targetKey(it);
          if (seenItems.has(k)) continue;
          seenItems.add(k);
          items.push({ type: it.type, slug: it.slug, addedAt: Number(it.addedAt) || 0 });
        }
      }
      a.collections.push({ id: c.id, name: c.name.slice(0, MAX_NAME_LEN), createdAt: Number(c.createdAt) || 0, items });
    }
  }
  a.updatedAt = Number(raw.updatedAt) || null;
  return a;
}
function filterActivity(activity, types2) {
  const a = normalizeActivity(activity);
  if (!Array.isArray(types2) || types2.length === 0) return a;
  const allow = new Set(types2);
  a.favorites = a.favorites.filter((f2) => allow.has(f2.type));
  a.upvotes = a.upvotes.filter((u) => allow.has(u.type));
  a.collections = a.collections.map((c) => ({ ...c, items: c.items.filter((it) => allow.has(it.type)) }));
  return a;
}

// client/src/member-admin-client.mjs
var trimBase11 = (signupBase) => String(signupBase || "").replace(/\/$/, "");
var AdminClientError = class extends Error {
};
async function getRosterStatuses({ token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/admin/statuses", {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `admin statuses request failed (${res.status})`);
  return { statuses: data?.statuses ?? {}, logins: data?.logins ?? {} };
}
async function getDiscordChannels({ token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/discord-channels", {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `discord channels request failed (${res.status})`);
  return data?.channels ?? [];
}
async function triggerAdminOp({ token, signupBase, fetch: fetch2 = globalThis.fetch, action, params }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/admin/ops", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(params ? { action, params } : { action })
    // SOW-055: category-migrate carries params
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `operation failed (${res.status})`);
  return data;
}
async function getCouponUsage({ token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/admin/coupon-usage", {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `coupon usage request failed (${res.status})`);
  return { usage: data?.usage ?? {}, configFresh: data?.configFresh ?? false };
}
async function getSyndicationQueue({ token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/syndication", { method: "GET", headers: { Authorization: "Bearer " + token } });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `syndication queue request failed (${res.status})`);
  return data;
}
async function getSyndicateNow({ token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/syndicate-now", { method: "GET", headers: { Authorization: "Bearer " + token } });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `syndicate-now info failed (${res.status})`);
  return data;
}
async function syndicateNow({ destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft, token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/syndicate-now", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `syndicate-now failed (${res.status})`);
  return data;
}
async function cancelSyndication({ id, token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/syndication/cancel", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `cancel request failed (${res.status})`);
  return data;
}
async function approveSyndication({ id, token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/syndication/approve", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `approve request failed (${res.status})`);
  return data;
}
async function getSocialQueue({ token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/social-queue", { method: "GET", headers: { Authorization: "Bearer " + token } });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `social queue request failed (${res.status})`);
  return data;
}
async function socialQueueAction({ action, id, token, signupBase, fetch: fetch2 = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError("not signed in");
  const res = await fetch2(trimBase11(signupBase) + "/membership/social-queue", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ action, id })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `social queue action failed (${res.status})`);
  return data;
}

// client/src/operations.mjs
var OperationError = class extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = "OperationError";
    this.code = code;
    this.details = details;
  }
};
function requireIdentity(ctx) {
  const id = ctx.identity?.();
  if (!id?.username) throw new OperationError("no-identity", "no signed-in identity; run `gbti login`");
  return id;
}
function requireRepo(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError("not-authenticated", "not authenticated; run `gbti login` first");
  return repo;
}
async function requireSuperadminForHouse(ctx) {
  const id = requireIdentity(ctx);
  let rolesParsed = {};
  try {
    rolesParsed = index_vite_proxy_tmp_default.load(await ctx.reader?.readFile?.("house/roles.yml") || "") || {};
  } catch {
    rolesParsed = {};
  }
  const role = roleOf2(String(id.githubId), rolesFromParsed2(rolesParsed));
  if (role !== "superadmin") throw new OperationError("forbidden", `house content is superadmin-only (you are ${role})`);
  return { id, role };
}
var NETWORK_CONTENT_PATH_RE = new RegExp(`^members/${NETWORK_CONTENT_OWNER}/(posts|products|prompts)/[a-z0-9][a-z0-9-]*/index\\.md$`);
var isNetworkContentPath = (p) => String(p || "").startsWith(`members/${NETWORK_CONTENT_OWNER}/`);
async function listContent(ctx, { type, scope = "member" } = {}) {
  const id = requireIdentity(ctx);
  if (scope === "house") {
    await requireSuperadminForHouse(ctx);
    return { items: await ctx.reader.list(NETWORK_CONTENT_OWNER, type || void 0, "member") };
  }
  return { items: await ctx.reader.list(id.username, type || void 0, "member") };
}
async function listMembersOnly(ctx) {
  requireIdentity(ctx);
  return { items: await ctx.reader.listMembersOnly() ?? [] };
}
async function listShares(ctx, { limit } = {}) {
  requireIdentity(ctx);
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 40;
  if (typeof ctx.reader?.listShares !== "function") return { items: [] };
  const items = await ctx.reader.listShares(n) ?? [];
  const membership = await membershipOf(ctx);
  if (canSeeShares(membership)) return { items };
  return { items: items.filter((s) => String(s?.visibility || "members").toLowerCase() === "public") };
}
async function membershipOf(ctx) {
  const m = await (ctx.membershipResolved ? ctx.membershipResolved() : ctx.membership?.());
  return m ?? "unknown";
}
function gateMemberComments(items, membership) {
  if (canSeeShares(membership ?? "unknown")) return items ?? [];
  return (items ?? []).filter((c) => String(c?.visibility || "public").toLowerCase() !== "members");
}
async function mergeCommentEchoesFor(ctx, { targetType, targetSlug, deployed }) {
  const token = ctx.store?.get?.("githubToken");
  if (!token || !targetType || !targetSlug) return deployed;
  const opts = { token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  let echoes = [];
  try {
    echoes = (await getCommentEchoes({ targetType, targetSlug, ...opts }))?.echoes ?? [];
  } catch {
    return deployed;
  }
  if (!echoes.length) return deployed;
  const { comments, reap } = mergeCommentEchoes({ deployed, echoes });
  if (reap.length) reapCommentEchoes({ targetType, targetSlug, ids: reap, ...opts }).catch(() => {
  });
  return comments;
}
async function listShareComments(ctx, { targetSlug, limit } = {}) {
  return listComments(ctx, { targetType: "share", targetSlug, limit });
}
var COMMENT_TARGET_TYPES = /* @__PURE__ */ new Set(["post", "product", "prompt", "share", "news"]);
var COMMENTS_INDEX_URL = "https://gbti.network/comments-index.json";
var COMMENTS_INDEX_TTL_MS = 6e4;
var commentsIndexCache = null;
async function fetchCommentsIndex(ctx) {
  const now = Date.now();
  if (commentsIndexCache && now - commentsIndexCache.at < COMMENTS_INDEX_TTL_MS) return commentsIndexCache.items;
  const f2 = ctx.fetch ?? globalThis.fetch;
  const res = await f2(COMMENTS_INDEX_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`comments index ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  commentsIndexCache = { at: now, items };
  return items;
}
async function listComments(ctx, { targetType, targetSlug, limit, aliases } = {}) {
  requireIdentity(ctx);
  if (!COMMENT_TARGET_TYPES.has(targetType)) throw new OperationError("bad-request", "a valid targetType is required");
  if (!targetSlug || typeof targetSlug !== "string") throw new OperationError("bad-request", "targetSlug is required");
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  let items = null;
  try {
    const all = await fetchCommentsIndex(ctx);
    const slugs = /* @__PURE__ */ new Set([targetSlug, ...Array.isArray(aliases) ? aliases : []]);
    items = all.filter((c) => c?.targetType === targetType && slugs.has(c?.targetSlug) && (c?.status ?? "published") === "published").sort(byCommentOldest).slice(0, n);
  } catch {
    if (typeof ctx.reader?.listComments !== "function") return { items: [] };
    items = await ctx.reader.listComments(targetType, targetSlug, n, Array.isArray(aliases) ? aliases : []) ?? [];
  }
  const gated = gateMemberComments(items, await membershipOf(ctx));
  return { items: await mergeCommentEchoesFor(ctx, { targetType, targetSlug, deployed: gated }) };
}
async function readContent(ctx, { path } = {}) {
  requireIdentity(ctx);
  if (!path || typeof path !== "string") throw new OperationError("bad-request", "path is required");
  if (typeof ctx.reader?.read !== "function") throw new OperationError("not-found", "no such readable content");
  const item = await ctx.reader.read(path);
  if (!item) throw new OperationError("not-found", "no such readable content");
  return item;
}
async function getContentItem(ctx, { path } = {}) {
  const id = requireIdentity(ctx);
  if (!path) throw new OperationError("bad-request", "path is required");
  if (isNetworkContentPath(path) && id.username !== NETWORK_CONTENT_OWNER) {
    if (!NETWORK_CONTENT_PATH_RE.test(path)) throw new OperationError("bad-request", "invalid network content path");
    await requireSuperadminForHouse(ctx);
    const text = await ctx.reader?.readFile?.(path);
    if (text == null) throw new OperationError("not-found", "no such network content item");
    const { frontmatter, body } = parseContentFile(text);
    return { path, frontmatter, body };
  }
  const item = await ctx.reader.get(id.username, path);
  if (!item) throw new OperationError("not-found", "no such item in your folder");
  return item;
}
function validateContent(ctx, { type, input, body } = {}) {
  const id = requireIdentity(ctx);
  try {
    const built = buildContentFile({ type, username: id.username, input, body });
    return { valid: true, path: built.path };
  } catch (err) {
    if (err instanceof ContentValidationError) return { valid: false, error: err.message, issues: err.issues };
    return { valid: false, error: err.message };
  }
}
var RENAME_URL_BASE = { post: "/articles", product: "/products", prompt: "/prompts" };
var SLUG_RE2 = /^[a-z0-9][a-z0-9-]*$/;
function renameOriginOf({ path, username, type }) {
  const m = OWN_STATUS_PATH_RE.exec(String(path || ""));
  if (!m) return null;
  if (m[1] !== String(username).toLowerCase()) return null;
  if (m[2].slice(0, -1) !== type) return null;
  return { oldSlug: m[3], oldPath: String(path) };
}
async function introMoveFiles(ctx, { username, type, oldSlug, newSlug }) {
  if (!["product", "prompt"].includes(type)) return [];
  const oldIntro = `members/${username}/comments/intro-${oldSlug}.md`;
  const introText = await ctx.reader?.readFile?.(oldIntro);
  if (introText == null) return [];
  const intro = parseContentFile(introText);
  const introFm = { ...intro.frontmatter ?? {}, id: `intro-${newSlug}`, targetSlug: newSlug };
  return [
    { path: `members/${username}/comments/intro-${newSlug}.md`, content: serializeContentFile(introFm, intro.body) },
    { path: oldIntro, content: null }
  ];
}
async function renameContent(ctx, { path: rel, newSlug } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const m = OWN_STATUS_PATH_RE.exec(String(rel || ""));
  if (!m) throw new OperationError("bad-request", "path must be members/<you>/(posts|products|prompts)/<slug>/index.md");
  if (m[1] !== String(id.username).toLowerCase()) {
    throw new OperationError("forbidden", "you may only rename your own content");
  }
  const type = m[2].slice(0, -1);
  const oldSlug = m[3];
  const slug = String(newSlug || "").trim();
  if (!SLUG_RE2.test(slug)) throw new OperationError("bad-request", "the new permalink must be lowercase letters, digits, and hyphens");
  if (slug === oldSlug) return { ok: true, noop: true, slug };
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError("membership-required", "Renaming a published item requires a paid membership.", { membership });
  }
  const hosted = isHostedCtx(ctx);
  if (!hosted) {
    const fork2 = await repo.ensureFork();
    for (const s of [oldSlug, slug]) {
      const branch2 = branchName(type, s);
      const staged = await repo.getBranchSha(fork2.full_name, branch2).catch(() => null);
      if (staged) throw new OperationError("bad-request", `a staged draft exists for "${s}" — publish or discard it first`);
      const pull = await repo.findOpenPull({ head: `${fork2.owner}:${branch2}` }).catch(() => null);
      if (pull) throw new OperationError("bad-request", `an open pull request exists for "${s}" — wait for it to merge or close it first`);
    }
  }
  const newPath = contentPath(type, id.username, slug);
  const collision = await repo.getFileContent(newPath).catch(() => null);
  if (collision != null) throw new OperationError("bad-request", `the permalink "${slug}" is already taken`);
  const oldText = await ctx.reader?.readFile?.(rel);
  if (oldText == null) throw new OperationError("not-found", `no such file: ${rel}`);
  const { frontmatter, body } = parseContentFile(oldText);
  const fm = { ...frontmatter ?? {} };
  const oldUrl = `${RENAME_URL_BASE[type]}/${oldSlug}/`;
  fm.slug = slug;
  fm.redirectFrom = [.../* @__PURE__ */ new Set([...Array.isArray(fm.redirectFrom) ? fm.redirectFrom : [], oldUrl])];
  fm.updatedAt = ctx.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
  const files = [];
  if (typeof fm.encryptedBody === "string" && fm.encryptedBody) {
    const oldEnc = fm.encryptedBody;
    const encText = await ctx.reader?.readFile?.(oldEnc);
    if (encText == null) throw new OperationError("not-found", `the encrypted body is missing: ${oldEnc}`);
    const { path: newEnc } = encAssetFor(type, id.username, slug);
    fm.encryptedBody = newEnc;
    files.push({ path: newEnc, content: encText }, { path: oldEnc, content: null });
  }
  files.push({ path: newPath, content: serializeContentFile(fm, body) }, { path: rel, content: null });
  files.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug, newSlug: slug }));
  const branch = `gbti/rename-${type}-${oldSlug}`;
  if (hosted) {
    const pr2 = await hostedPublishFiles(ctx, { branch, files, title: `Rename: ${oldSlug} -> ${slug}` });
    return { ...pr2, ok: true, type, oldSlug, slug, path: newPath };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch);
  const fork = await repo.ensureFork();
  const base3 = await repo.getDefaultBranch(repo.upstream);
  const baseSha = await repo.getBranchSha(fork.full_name, base3).catch(() => null);
  const oldOnBase = baseSha ? await repo.getFileSha(fork.full_name, rel, base3).catch(() => null) : null;
  if (!oldOnBase) {
    throw new OperationError("bad-request", "the rename needs your fork to sync with the network first (the publisher app needs its updated permissions approved) — try again later or contact the co-op");
  }
  const pr = await publishFiles({
    repo,
    branch,
    files,
    message: `Rename ${type} ${oldSlug} -> ${slug}`,
    title: `Rename: ${oldSlug} -> ${slug}`,
    body: `Permalink rename (SOW-112). ${oldUrl} redirects to ${RENAME_URL_BASE[type]}/${slug}/ after the next deploy.`
  });
  return { ...pr, ok: true, type, oldSlug, slug, path: newPath };
}
var OWN_STATUS_PATH_RE = /^members\/([a-z0-9][a-z0-9-]*)\/(posts|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;
async function setOwnContentStatus(ctx, { path: rel, status } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  if (status !== "published" && status !== "draft") {
    throw new OperationError("bad-request", 'status must be "published" or "draft"');
  }
  const houseTarget = isNetworkContentPath(rel);
  let type, slug, branch;
  if (houseTarget) {
    const hm = NETWORK_CONTENT_PATH_RE.exec(String(rel || ""));
    if (!hm) throw new OperationError("bad-request", "invalid house content path");
    await requireSuperadminForHouse(ctx);
    type = hm[1].slice(0, -1);
    slug = String(rel).split("/")[2];
    branch = `gbti/status-house-${type}-${slug}`;
  } else {
    const m = OWN_STATUS_PATH_RE.exec(String(rel || ""));
    if (!m) throw new OperationError("bad-request", "path must be members/<you>/(posts|products|prompts)/<slug>/index.md");
    if (m[1] !== String(id.username).toLowerCase()) {
      throw new OperationError("forbidden", "you may only change the status of your own content");
    }
    type = m[2].slice(0, -1);
    slug = m[3];
    branch = `gbti/status-${type}-${slug}`;
  }
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError("membership-required", "Changing a published item requires a paid membership.", { membership });
  }
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError("not-found", `no such file: ${rel}`);
  const flip = flipContentStatus(text, status);
  if (!flip.changed) return { ok: true, noop: true, status };
  const verb = status === "draft" ? "Unpublish" : "Republish";
  if (isHostedCtx(ctx)) {
    const pr2 = await hostedPublishFiles(ctx, { branch, files: [{ path: rel, content: flip.content }], title: `${verb}: ${slug}` });
    return { ...pr2, ok: true, status };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch);
  const pr = await publishFiles({
    repo,
    branch,
    files: [{ path: rel, content: flip.content }],
    message: `${verb} ${slug}`,
    title: `${verb}: ${slug}`,
    body: status === "draft" ? "Member unpublish: a reversible status flip to draft (SOW-106). The file stays in the repo; republishing reverses it." : "Member republish: the status flips back to published (SOW-106)."
  });
  return { ...pr, ok: true, status };
}
async function syncForkIfCreatingBranch(ctx, repo, branch, { sync = workerSyncFork } = {}) {
  try {
    const fork = await repo.ensureFork();
    const exists = await repo.getBranchSha(fork.full_name, branch).then((sha) => Boolean(sha)).catch(() => false);
    if (exists) {
      let open = null;
      try {
        open = await repo.findOpenPull({ head: `${fork.owner}:${branch}` });
      } catch {
        open = { number: -1 };
      }
      if (open) return { synced: false, reason: "branch-exists" };
    }
    const token = ctx.store?.get?.("githubToken");
    return await sync({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch {
    return { synced: false, reason: "error" };
  }
}
async function publish(ctx, { type, input, body, message, title, prBody: prBody2, authorNote, path, scope } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const houseTarget = scope === "house" || isNetworkContentPath(path);
  const targetScope = houseTarget ? "house" : "member";
  if (houseTarget) await requireSuperadminForHouse(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError(
      "membership-required",
      "Publishing on gbti.network requires a paid membership. Your draft is saved on your own fork. Upgrade to a paid membership at https://gbti.network, and your client publishes your staged drafts.",
      { membership }
    );
  }
  const origin = houseTarget ? null : renameOriginOf({ path, username: id.username, type });
  let oldFm = null;
  if (origin) {
    const oldText = await ctx.reader?.readFile?.(origin.oldPath);
    if (oldText != null) oldFm = parseContentFile(oldText).frontmatter ?? {};
  }
  const effInput = { ...input ?? {} };
  const renaming = Boolean(oldFm) && typeof effInput.slug === "string" && effInput.slug !== origin.oldSlug;
  if (oldFm) {
    const keep = Array.isArray(oldFm.redirectFrom) ? oldFm.redirectFrom : [];
    const oldUrl = renaming ? `${RENAME_URL_BASE[type]}/${origin.oldSlug}/` : null;
    const merged = [.../* @__PURE__ */ new Set([...keep, ...Array.isArray(effInput.redirectFrom) ? effInput.redirectFrom : [], ...oldUrl ? [oldUrl] : []])];
    if (merged.length) effInput.redirectFrom = merged;
    if (renaming && oldFm.publishedAt) effInput.publishedAt = oldFm.publishedAt;
  }
  if (["post", "product", "prompt"].includes(type) && !effInput.publishedAt) {
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let priorFm = oldFm;
    if (!priorFm && typeof effInput.slug === "string" && effInput.slug) {
      const canonical = contentPath(type, id.username, effInput.slug, targetScope);
      let text = null;
      try {
        text = await ctx.reader?.readFile?.(canonical) ?? null;
      } catch {
        text = null;
      }
      if (text == null) {
        try {
          text = await repo.getFileContent(canonical) ?? null;
        } catch {
          text = null;
        }
      }
      if (text != null) {
        try {
          priorFm = parseContentFile(text).frontmatter ?? {};
        } catch {
          priorFm = null;
        }
      }
    }
    effInput.publishedAt = priorFm?.publishedAt ?? nowIso;
    if (priorFm) effInput.updatedAt = nowIso;
  }
  let built;
  try {
    built = buildContentFile({ type, username: id.username, input: { ...effInput, status: effInput.status || "published" }, body, scope: targetScope });
  } catch (err) {
    throw new OperationError("invalid-content", err.message, err instanceof ContentValidationError ? err.issues : void 0);
  }
  if (renaming) {
    const collision = await repo.getFileContent(built.path).catch(() => null);
    if (collision != null) throw new OperationError("bad-request", `the permalink "${built.slug}" is already taken`);
  }
  const token = ctx.store?.get?.("githubToken");
  const encrypt = (plaintext, assetId) => encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError("membership-required", "Publishing member-only content requires a paid membership. Your draft is saved; upgrade at https://gbti.network and publish.", { membership });
    }
    throw err;
  }
  const introFile = buildIntroCommentFile({ username: id.username, built, authorNote, now: ctx.now?.() });
  const desc = describeContentPublish(built, { hasIntro: Boolean(introFile) });
  const msg = message ?? desc.message;
  const ttl = title ?? desc.title;
  const bdy = prBody2 ?? desc.body;
  if (isHostedCtx(ctx)) {
    const hostedRenameFiles = [];
    if (renaming) {
      const onMain = await ctx.reader?.readFile?.(origin.oldPath) != null;
      if (!onMain) throw new OperationError("bad-request", "the original item could not be found on the network — refresh and try the rename again");
      hostedRenameFiles.push({ path: origin.oldPath, content: null });
      if (typeof oldFm?.encryptedBody === "string" && oldFm.encryptedBody) hostedRenameFiles.push({ path: oldFm.encryptedBody, content: null });
      if (!introFile) {
        hostedRenameFiles.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug: origin.oldSlug, newSlug: built.slug }));
      } else {
        const oldIntro = `members/${id.username}/comments/intro-${origin.oldSlug}.md`;
        if (await ctx.reader?.readFile?.(oldIntro) != null) hostedRenameFiles.push({ path: oldIntro, content: null });
      }
    }
    const files = (plan ? plan.files : [{ path: built.path, content: built.markdown }]).concat(introFile ? [introFile] : []).concat(hostedRenameFiles);
    const r = await hostedAuthor({
      token: ctx.store?.get?.("githubToken"),
      itemId: hostedItemId(built.type, renaming ? origin.oldSlug : built.slug),
      files,
      title: ttl,
      signupBase: SIGNUP_BASE,
      fetchImpl: ctx.fetch ?? globalThis.fetch
    });
    return renaming ? { ...r, renamed: { from: origin.oldSlug, to: built.slug } } : r;
  }
  const branch = branchName(built.type, renaming ? origin.oldSlug : built.slug, built.scope);
  await syncForkIfCreatingBranch(ctx, repo, branch);
  let renameFiles = [];
  if (renaming) {
    const fork = await repo.ensureFork();
    const base3 = await repo.getDefaultBranch(repo.upstream);
    const token2 = ctx.store?.get?.("githubToken");
    await workerSyncFork({ token: token2, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    const onMain = await repo.getFileSha(fork.full_name, origin.oldPath, base3).catch(() => null);
    if (!onMain) {
      throw new OperationError("bad-request", "the rename needs your fork to sync with the network first (the publisher app needs its updated permissions approved) — your draft is saved; try publishing again later or contact the co-op");
    }
    const branchSha = await repo.getBranchSha(fork.full_name, branch).catch(() => null);
    if (branchSha) {
      const pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }).catch(() => null);
      if (pull) throw new OperationError("bad-request", `an open pull request exists for this item (#${pull.number}) — wait for it to merge or close it, then publish the rename`);
      await repo.deleteBranch(fork.full_name, branch).catch(() => {
      });
    }
    renameFiles.push({ path: origin.oldPath, content: null });
    if (typeof oldFm.encryptedBody === "string" && oldFm.encryptedBody) renameFiles.push({ path: oldFm.encryptedBody, content: null });
    if (!introFile) {
      renameFiles.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug: origin.oldSlug, newSlug: built.slug }));
    } else {
      const oldIntro = `members/${id.username}/comments/intro-${origin.oldSlug}.md`;
      if (await ctx.reader?.readFile?.(oldIntro) != null) renameFiles.push({ path: oldIntro, content: null });
    }
  }
  const withRename = (r) => renaming ? { ...r, renamed: { from: origin.oldSlug, to: built.slug } } : r;
  if (introFile || renaming) {
    const files = (plan ? plan.files : [{ path: built.path, content: built.markdown }]).concat(introFile ? [introFile] : []).concat(renameFiles);
    return withRename(await publishFiles({ repo, branch, files, message: msg, title: ttl, body: bdy }));
  }
  if (plan) {
    return withRename(await publishFiles({ repo, branch, files: plan.files, message: msg, title: ttl, body: bdy }));
  }
  return publishContent({ repo, change: built, message: msg, title: ttl, body: bdy });
}
function describeContentPublish(built, { hasIntro } = {}) {
  const LABEL = { post: "article", product: "product", prompt: "prompt", profile: "profile" };
  const label = LABEL[built?.type] ?? built?.type ?? "content";
  if (built?.type === "profile") {
    const t = `Update the ${built.username} member profile`;
    return { title: t, message: t, body: `Update the ${built.username} member profile.` };
  }
  const name = built?.frontmatter?.title || built?.slug || label;
  const title = `Publish ${label}: ${name}`;
  const blurb = built?.frontmatter?.shortDescription || built?.frontmatter?.excerpt || "";
  const cats = Array.isArray(built?.frontmatter?.categories) ? built.frontmatter.categories.join(" > ") : "";
  const lines = [`## ${name}`, ""];
  if (blurb) lines.push(blurb, "");
  lines.push(`- Type: ${label}`);
  if (cats) lines.push(`- Category: ${cats}`);
  lines.push(`- Path: \`${built?.path ?? ""}\``);
  if (hasIntro) lines.push("- Includes the from-the-author intro comment.");
  lines.push("", "_Published through the GBTI Network client._");
  return { title, message: title, body: lines.join("\n") };
}
function buildIntroCommentFile({ username, built, authorNote, now } = {}) {
  const note = String(authorNote ?? "").trim();
  if (!note || !built?.slug || !["product", "prompt"].includes(built.type)) return null;
  const introBuilt = buildCommentFile({
    username,
    // SOW-145: a house product/prompt intro lands at house/comments/ with author 'gbti' (mirrors the item scope).
    scope: built.scope || "member",
    input: {
      id: `intro-${built.slug}`,
      targetType: built.type,
      targetSlug: built.slug,
      createdAt: now ?? (/* @__PURE__ */ new Date()).toISOString(),
      status: "published",
      visibility: "public",
      authorNote: true
    },
    body: note
  });
  return { path: introBuilt.path, content: introBuilt.markdown };
}
async function planMemberFiles({ built, body, encrypt }) {
  if (!built?.slug) return null;
  const vis = built.frontmatter?.visibility ?? "public";
  let publicPart = "";
  let memberPart = null;
  if (vis === "members") {
    memberPart = String(body ?? "").trim();
    if (!memberPart) return null;
  } else {
    const split = splitMemberMarkdown(body);
    if (split.memberPart == null) return null;
    publicPart = split.publicPart;
    memberPart = split.memberPart;
    if (!memberPart) {
      return { files: [{ path: built.path, content: serializeContentFile(built.frontmatter, publicPart) }] };
    }
  }
  const { assetId, path: encPath } = encAssetFor(built.type, built.username, built.slug, built.scope);
  const envelope = await encrypt(memberPart, assetId);
  const markdown = serializeContentFile({ ...built.frontmatter, encryptedBody: encPath }, publicPart);
  return {
    files: [
      { path: built.path, content: markdown },
      { path: encPath, content: JSON.stringify(envelope) }
    ],
    encPath,
    assetId
  };
}
function draftMetaFromBranch(branch) {
  if (branch === "gbti/profile") return { type: "profile", slug: null };
  const m = String(branch || "").match(/^gbti\/(post|product|prompt)-(.+)$/);
  return m ? { type: m[1], slug: m[2] } : null;
}
async function saveDraft(ctx, { type, input, body, message, path } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (membership !== "unknown" && !canStageDrafts(membership)) {
    throw new OperationError("forbidden", "Saving drafts requires an active trial or paid membership.", { membership });
  }
  let built;
  try {
    built = buildContentFile({ type, username: id.username, input: { ...input ?? {}, status: input && input.status || "published" }, body });
  } catch (err) {
    throw new OperationError("invalid-content", err.message, err instanceof ContentValidationError ? err.issues : void 0);
  }
  const origin = renameOriginOf({ path, username: id.username, type: built.type });
  const staging = origin && built.slug !== origin.oldSlug ? origin : null;
  const branch = branchName(built.type, staging ? staging.oldSlug : built.slug);
  if (isHostedCtx(ctx)) {
    let fm = {};
    try {
      fm = parseContentFile(built.markdown).frontmatter ?? {};
    } catch {
      fm = {};
    }
    await workerPutDraft({
      draft: {
        type: built.type,
        slug: staging ? staging.oldSlug : built.slug,
        pendingSlug: staging ? built.slug : null,
        path: staging ? staging.oldPath : built.path,
        frontmatter: fm,
        body
      },
      token: ctx.store?.get?.("githubToken"),
      signupBase: SIGNUP_BASE,
      fetch: ctx.fetch ?? globalThis.fetch
    });
    return { ok: true, branch, type: built.type, slug: built.slug ?? null, path: staging ? staging.oldPath : built.path, state: "staged", hosted: true, ...staging ? { renamed: { from: staging.oldSlug, to: built.slug } } : {} };
  }
  const token = ctx.store?.get?.("githubToken");
  const encrypt = (plaintext, assetId) => encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError("membership-required", "Staging members-only content requires a paid membership. Save it as public, or upgrade to a paid membership.", { membership });
    }
    throw err;
  }
  let files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  if (staging) files = files.map((f2) => f2.path === built.path ? { ...f2, path: staging.oldPath } : f2);
  await syncForkIfCreatingBranch(ctx, repo, branch);
  await commitToBranchOnFork({ repo, branch, files, message: message ?? `Draft: ${built.slug ?? built.type}` });
  return { ok: true, branch, type: built.type, slug: built.slug ?? null, path: staging ? staging.oldPath : built.path, state: "staged", ...staging ? { renamed: { from: staging.oldSlug, to: built.slug } } : {} };
}
async function forkContentMatchesLive(ctx, path, forkText) {
  try {
    const staged = parseContentFile(forkText);
    if (staged.frontmatter?.encryptedBody) return false;
    const live = await ctx.reader?.read?.(path);
    if (!live) return false;
    return String(staged.body ?? "").trim() === String(live.body ?? "").trim() && JSON.stringify(staged.frontmatter ?? {}) === JSON.stringify(live.frontmatter ?? {});
  } catch {
    return false;
  }
}
async function foldRepoDrafts(ctx, drafts, type) {
  let items = [];
  try {
    const token = ctx.store?.get?.("githubToken");
    const r = await workerListRepoDrafts({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    items = Array.isArray(r?.items) ? r.items : [];
  } catch {
    items = [];
  }
  return mergeRepoDrafts(drafts, items, { type });
}
async function listDrafts(ctx, { type } = {}) {
  const id = requireIdentity(ctx);
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.("githubToken"), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const drafts2 = [];
    for (const r of recs ?? []) {
      if (type && r.type !== type) continue;
      let valid = true;
      let invalidReason = null;
      try {
        buildContentFile({ type: r.type, username: id.username, input: r.frontmatter ?? {}, body: r.body ?? "" });
      } catch (err) {
        valid = false;
        invalidReason = err?.message || "this draft no longer matches the current schema";
      }
      let rowPath = r.path;
      if (!rowPath) {
        try {
          rowPath = contentPath(r.type, id.username, r.slug);
        } catch {
          rowPath = null;
        }
      }
      drafts2.push({
        type: r.type,
        slug: r.slug,
        branch: branchName(r.type, r.slug),
        path: rowPath,
        pendingSlug: r.pendingSlug ?? null,
        title: r.frontmatter?.title || r.frontmatter?.displayName || r.slug || r.type,
        visibility: r.frontmatter?.visibility || "public",
        status: r.frontmatter?.status || "draft",
        valid,
        invalidReason,
        pull: null,
        store: "kv"
        // sow-194: the store discriminator, so a repo draft never collides with a KV draft
      });
    }
    return { drafts: await foldRepoDrafts(ctx, drafts2, type) };
  }
  const repo = requireRepo(ctx);
  const fork = await repo.ensureFork();
  const refs = await repo.listMatchingRefs(fork.full_name, "gbti/");
  const drafts = [];
  for (const { branch, sha } of refs) {
    const meta3 = draftMetaFromBranch(branch);
    if (!meta3) continue;
    if (type && meta3.type !== type) continue;
    let path;
    try {
      path = contentPath(meta3.type, id.username, meta3.slug);
    } catch {
      continue;
    }
    let text = null;
    try {
      text = await repo.getForkFileContent(fork.full_name, path, sha || branch);
    } catch {
      text = null;
    }
    if (!text) continue;
    let fm = {};
    let draftBody = "";
    try {
      const parsed = parseContentFile(text);
      fm = parsed.frontmatter ?? {};
      draftBody = parsed.body ?? "";
    } catch {
      fm = {};
    }
    let valid = true;
    let invalidReason = null;
    try {
      buildContentFile({ type: meta3.type, username: id.username, input: fm, body: draftBody });
    } catch (err) {
      valid = false;
      invalidReason = err?.message || "this draft no longer matches the current schema";
    }
    let pull = null;
    try {
      pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` });
    } catch {
      pull = null;
    }
    if (!pull && await forkContentMatchesLive(ctx, path, text)) {
      try {
        await repo.deleteBranch(fork.full_name, branch);
      } catch {
      }
      continue;
    }
    drafts.push({
      type: meta3.type,
      slug: meta3.slug,
      branch,
      path,
      // SOW-112 v2: a frontmatter slug that differs from the branch identity is a PENDING RENAME (it applies
      // when the draft publishes). Surfaced so same-titled drafts are tellable apart in the Drafts tab.
      pendingSlug: typeof fm.slug === "string" && fm.slug !== meta3.slug ? fm.slug : null,
      title: fm.title || fm.displayName || meta3.slug || meta3.type,
      visibility: fm.visibility || "public",
      status: fm.status || "draft",
      valid,
      invalidReason,
      pull: pull ? { number: pull.number, html_url: pull.html_url } : null,
      store: "fork"
      // sow-194: the store discriminator, so a repo draft never collides with a fork draft
    });
  }
  return { drafts: await foldRepoDrafts(ctx, drafts, type) };
}
async function readDraft(ctx, { type, slug, store, path: repoPath } = {}) {
  const id = requireIdentity(ctx);
  if (!type) throw new OperationError("bad-request", "type is required");
  if (store === "repo") {
    let rel = repoPath;
    if (!rel) {
      try {
        rel = contentPath(type, id.username, slug);
      } catch {
        rel = null;
      }
    }
    if (!rel) throw new OperationError("bad-request", "a repo draft needs its path");
    let text2 = null;
    try {
      text2 = await ctx.reader?.readFile?.(rel);
    } catch {
      text2 = null;
    }
    if (text2 == null) throw new OperationError("not-found", `could not read the repo draft: ${rel}`);
    const { frontmatter: frontmatter2, body: body2 } = parseContentFile(text2);
    if (frontmatter2?.encryptedBody) {
      try {
        const { text: plain } = await decryptMemberAsset(ctx, { encPath: frontmatter2.encryptedBody });
        return { path: rel, branch: null, store: "repo", frontmatter: frontmatter2, body: plain };
      } catch {
      }
    }
    return { path: rel, branch: null, store: "repo", frontmatter: frontmatter2, body: body2 };
  }
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.("githubToken"), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const rec = (recs ?? []).find((r) => r.type === type && r.slug === slug);
    if (!rec) throw new OperationError("not-found", "no such draft");
    let recPath = rec.path;
    if (!recPath) {
      try {
        recPath = contentPath(type, id.username, slug);
      } catch {
        recPath = null;
      }
    }
    return { path: recPath, branch: branchName(type, slug), frontmatter: rec.frontmatter ?? {}, body: rec.body ?? "" };
  }
  const repo = requireRepo(ctx);
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  let path;
  try {
    path = contentPath(type, id.username, slug);
  } catch (err) {
    throw new OperationError("bad-request", err.message);
  }
  const text = await repo.getForkFileContent(fork.full_name, path, branch);
  if (!text) throw new OperationError("not-found", "no such draft on your fork");
  const { frontmatter, body } = parseContentFile(text);
  if (frontmatter?.encryptedBody) {
    try {
      const { text: plain } = await decryptMemberAsset(ctx, { encPath: frontmatter.encryptedBody });
      return { path, branch, frontmatter, body: plain };
    } catch {
    }
  }
  return { path, branch, frontmatter, body };
}
async function discardDraft(ctx, { type, slug, store } = {}) {
  requireIdentity(ctx);
  if (!type) throw new OperationError("bad-request", "type is required");
  if (store === "repo") throw new OperationError("unsupported", "This draft is committed to the network and cannot be discarded here. Publish it, or open a removal request.");
  if (isHostedCtx(ctx)) {
    await workerDeleteDraft({ type, slug, token: ctx.store?.get?.("githubToken"), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { ok: true, branch: branchName(type, slug), hosted: true };
  }
  const repo = requireRepo(ctx);
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  let pull = null;
  try {
    pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` });
  } catch {
    pull = null;
  }
  if (pull) throw new OperationError("bad-request", "This draft has an open pull request; withdraw it from review before discarding.", { prNumber: pull.number });
  try {
    await repo.deleteBranch(fork.full_name, branch);
  } catch (err) {
    const still = await repo.getBranchSha(fork.full_name, branch).catch(() => null);
    if (still) throw err;
    return { ok: true, branch, alreadyGone: true };
  }
  return { ok: true, branch };
}
async function publishDraft(ctx, { type, slug, title, prBody: prBody2, store, path } = {}) {
  const id = requireIdentity(ctx);
  if (store === "repo") {
    let rel = path;
    if (!rel) {
      try {
        rel = contentPath(type, id.username, slug);
      } catch {
        rel = null;
      }
    }
    if (!rel) throw new OperationError("bad-request", "a repo draft needs its path to publish");
    return setOwnContentStatus(ctx, { path: rel, status: "published" });
  }
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError("membership-required", "Publishing on gbti.network requires a paid membership. Your draft is saved on your own fork. Upgrade to a paid membership at https://gbti.network, and your client publishes your staged drafts.", { membership });
  }
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.("githubToken"), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const rec = (recs ?? []).find((r2) => r2.type === type && r2.slug === slug);
    if (!rec) throw new OperationError("not-found", "no such draft");
    const r = await publish(ctx, {
      type,
      input: rec.frontmatter ?? {},
      body: rec.body ?? "",
      title,
      prBody: prBody2,
      ...rec.pendingSlug && rec.path ? { path: rec.path } : {}
      // a pending rename applies at the publish event (SOW-112)
    });
    try {
      await workerDeleteDraft({ type, slug, ...opts });
    } catch {
    }
    return { ...r, ok: true, hosted: true };
  }
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  const head = `${fork.owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) return { prNumber: existing.number, prUrl: existing.html_url, branch, updated: true };
  if (type !== "profile") {
    const oldPath = contentPath(type, id.username, slug);
    const text = await repo.getForkFileContent(fork.full_name, oldPath, branch).catch(() => null);
    if (text != null) {
      const parsed = parseContentFile(text);
      const fm = parsed.frontmatter ?? {};
      if (typeof fm.slug === "string" && fm.slug !== slug) {
        return publish(ctx, { type, input: { ...fm, status: "published" }, body: parsed.body, path: oldPath, title, prBody: prBody2 });
      }
    }
  }
  const base3 = await repo.getDefaultBranch(repo.upstream);
  const titleText = title ?? (type === "profile" ? `Update ${id.username}'s profile` : `${type}: ${slug}`);
  const pull = await repo.openPull({ title: titleText, head, base: base3, body: prBody2 ?? "" });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, updated: false };
}
var ENC_PATH_RE = /^(members\/[a-z0-9][a-z0-9-]*|house)\/_enc\/[a-z0-9][a-z0-9._-]*\.enc$/;
async function decryptMemberAsset(ctx, { encPath } = {}) {
  requireIdentity(ctx);
  if (!encPath || typeof encPath !== "string") throw new OperationError("bad-request", "encPath is required");
  if (!ENC_PATH_RE.test(encPath)) throw new OperationError("bad-request", "invalid encrypted-asset path");
  let raw;
  try {
    raw = await ctx.reader.readFile(encPath);
  } catch {
    throw new OperationError("not-found", `could not read the encrypted asset: ${encPath}`);
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new OperationError("bad-request", "the encrypted asset is not a valid envelope");
  }
  const token = ctx.store?.get?.("githubToken");
  try {
    const text = await decryptViaWorker({ envelope, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { text };
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError("membership-required", "This content is for paid members. Upgrade at https://gbti.network to unlock.");
    }
    throw new OperationError("decrypt-failed", err?.message || "could not decrypt the asset");
  }
}
async function publishShare(ctx, { input = {}, body = "", message, title, prBody: prBody2 } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError("membership-required", "Posting Shares on gbti.network requires a paid membership. Upgrade to a paid membership at https://gbti.network to post your Share.", { membership });
  }
  const createdAt = input.createdAt ?? (ctx.now?.() ?? (/* @__PURE__ */ new Date()).toISOString());
  const id_ = input.id ?? shareId(createdAt, input.title);
  let built;
  try {
    built = buildShareFile({ username: id.username, input: { ...input, id: id_, createdAt }, body });
  } catch (err) {
    throw new OperationError("invalid-content", err.message, err instanceof ContentValidationError ? err.issues : void 0);
  }
  const token = ctx.store?.get?.("githubToken");
  const encrypt = (plaintext, assetId) => encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError("membership-required", "Publishing a members-only Share requires a paid membership. Upgrade at https://gbti.network.", { membership });
    }
    throw err;
  }
  const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  const shareTitle = title ?? `New Share${built.frontmatter.title ? `: ${built.frontmatter.title}` : ""}`;
  const pr = isHostedCtx(ctx) ? await hostedPublishFiles(ctx, { branch: `gbti/share-${id_}`, files, title: shareTitle }) : await publishFiles({
    repo,
    branch: `gbti/share-${id_}`,
    // idempotent by branch: re-publishing the same id updates the same PR
    files,
    message: message ?? `Share: ${built.frontmatter.title || id_}`,
    title: shareTitle,
    body: prBody2
  });
  return { ...pr, id: id_, path: built.path, visibility: built.frontmatter.visibility ?? "members", encrypted: Boolean(plan?.encPath) };
}
var commentSuffix = () => Math.random().toString(36).slice(2, 8);
async function planAndPublishComment(ctx, repo, built, body, { message, title, prBody: prBody2 }) {
  const token = ctx.store?.get?.("githubToken");
  const encrypt = (plaintext, assetId) => encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError("membership-required", "Posting a members-only comment requires a paid membership. Upgrade at https://gbti.network.");
    }
    throw err;
  }
  const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  const pr = isHostedCtx(ctx) ? await hostedPublishFiles(ctx, { branch: `gbti/comment-${built.id}`, files, title }) : await publishFiles({ repo, branch: `gbti/comment-${built.id}`, files, message, title, body: prBody2 });
  return { ...pr, id: built.id, path: built.path, visibility: built.frontmatter.visibility ?? "public", encrypted: Boolean(plan?.encPath) };
}
async function publishComment(ctx, { targetType, targetSlug, body, authorNote, parentId, visibility, message, title, prBody: prBody2 } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError("membership-required", "Commenting on gbti.network requires a paid membership. Upgrade to a paid membership at https://gbti.network to join the conversation.", { membership });
  }
  const createdAt = ctx.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
  const cid = commentId(createdAt, commentSuffix());
  const input = { id: cid, targetType, targetSlug, createdAt, status: "published" };
  const isPublicIntro = authorNote === true && ["post", "product", "prompt"].includes(targetType);
  input.visibility = visibility === "public" && isPublicIntro ? "public" : "members";
  if (authorNote) input.authorNote = true;
  if (parentId) input.parentId = parentId;
  let built;
  try {
    built = buildCommentFile({ username: id.username, input, body });
  } catch (err) {
    throw new OperationError("invalid-content", err.message, err instanceof ContentValidationError ? err.issues : void 0);
  }
  const r = await planAndPublishComment(ctx, repo, built, body, {
    message: message ?? `Comment on ${targetType} ${targetSlug}`,
    title: title ?? `Comment on ${targetType}: ${targetSlug}`,
    prBody: prBody2
  });
  const out = { ...r, targetType: built.frontmatter.targetType, targetSlug: built.frontmatter.targetSlug };
  const echoToken = ctx.store?.get?.("githubToken");
  if (echoToken && out.prNumber) {
    addCommentEcho({
      echo: { id: cid, targetType: out.targetType, targetSlug: out.targetSlug, body, prNumber: out.prNumber, createdAt },
      token: echoToken,
      signupBase: SIGNUP_BASE,
      fetch: ctx.fetch ?? globalThis.fetch
    }).catch(() => {
    });
  }
  return out;
}
async function deleteComment(ctx, { id } = {}) {
  const identity = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const cid = String(id || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(cid)) throw new OperationError("bad-request", "a comment id is required");
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError("membership-required", "Managing comments on the network requires a paid membership.", { membership });
  }
  const rel = `members/${identity.username}/comments/${cid}.md`;
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError("not-found", `no such comment: ${cid}`);
  const fm = parseContentFile(text).frontmatter ?? {};
  if (String(fm.author || "").toLowerCase() !== String(identity.username).toLowerCase()) {
    throw new OperationError("forbidden", "you may only delete your own comments");
  }
  const branch = `gbti/comment-delete-${cid}`;
  if (isHostedCtx(ctx)) {
    const pr2 = await hostedPublishFiles(ctx, { branch, files: [{ path: rel, content: null }], title: `Delete comment: ${cid}` });
    return { ...pr2, ok: true, id: cid, path: rel };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch);
  const pr = await publishFiles({
    repo,
    branch,
    files: [{ path: rel, content: null }],
    message: `Delete comment ${cid}`,
    title: `Delete comment: ${cid}`,
    body: "The author removed their own comment."
  });
  return { ...pr, ok: true, id: cid, path: rel };
}
async function getComment(ctx, { id } = {}) {
  const idn = requireIdentity(ctx);
  if (!id || typeof id !== "string") throw new OperationError("bad-request", "a comment id is required");
  const item = await ctx.reader.get(idn.username, `members/${idn.username}/comments/${id}.md`);
  if (!item) throw new OperationError("not-found", "no such comment in your folder");
  const enc = item.frontmatter?.encryptedBody;
  if (enc) {
    const { text } = await decryptMemberAsset(ctx, { encPath: enc });
    return { ...item, body: text };
  }
  return item;
}
async function editComment(ctx, { id, body, authorNote } = {}) {
  const idn = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  if (!id || typeof id !== "string") throw new OperationError("bad-request", "a comment id is required");
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError("membership-required", "Editing a comment on gbti.network requires a paid membership. Upgrade at https://gbti.network.", { membership });
  }
  const existing = await ctx.reader.get(idn.username, `members/${idn.username}/comments/${id}.md`);
  if (!existing) throw new OperationError("not-found", "no such comment in your folder");
  if (existing.frontmatter?.author && existing.frontmatter.author !== idn.username) {
    throw new OperationError("not-authorized", "you can only edit your own comments");
  }
  const fm = existing.frontmatter ?? {};
  const updatedAt = ctx.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
  const effAuthorNote = authorNote !== void 0 ? Boolean(authorNote) : Boolean(fm.authorNote);
  const isPublicIntro = effAuthorNote && ["post", "product", "prompt"].includes(fm.targetType);
  const input = {
    id,
    targetType: fm.targetType,
    targetSlug: fm.targetSlug,
    status: fm.status ?? "published",
    visibility: fm.visibility === "public" && isPublicIntro ? "public" : "members",
    authorNote: effAuthorNote,
    parentId: fm.parentId,
    createdAt: fm.createdAt,
    updatedAt
  };
  let built;
  try {
    built = buildCommentFile({ username: idn.username, input, body });
  } catch (err) {
    throw new OperationError("invalid-content", err.message, err instanceof ContentValidationError ? err.issues : void 0);
  }
  const r = await planAndPublishComment(ctx, repo, built, body, {
    message: `Edit comment ${id}`,
    title: `Edit comment on ${fm.targetType}: ${fm.targetSlug}`,
    prBody: void 0
  });
  return { ...r, edited: true, targetType: fm.targetType, targetSlug: fm.targetSlug };
}
function mapActivityError(err) {
  if (err instanceof ActivityClientError && /not signed in/i.test(err.message)) {
    return new OperationError("not-authenticated", "Sign in to manage favorites and collections.");
  }
  return new OperationError("activity-failed", err?.message || "the activity request failed");
}
async function getMemberActivity(ctx, { types: types2 } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    const r = await getActivity({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    const activity = r?.activity ?? { favorites: [], collections: [] };
    return Array.isArray(types2) && types2.length ? filterActivity(activity, types2) : activity;
  } catch (err) {
    throw mapActivityError(err);
  }
}
async function getMemberEarnings(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await getEarnings({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new Error(err?.message || "could not load earnings");
  }
}
async function mutateMemberActivity(ctx, payload = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  const opts = { token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  try {
    switch (payload.action) {
      case "favorite":
        return await setFavorite({ ...payload, ...opts });
      case "collection.create":
        return await createCollection({ ...payload, ...opts });
      case "collection.rename":
        return await renameCollection({ ...payload, ...opts });
      case "collection.delete":
        return await deleteCollection({ ...payload, ...opts });
      case "collection.item":
        return await setCollectionItem({ ...payload, ...opts });
      default:
        throw new OperationError("bad-request", "unknown activity action");
    }
  } catch (err) {
    if (err instanceof OperationError) throw err;
    throw mapActivityError(err);
  }
}
function mapFollowsError(err) {
  if (err instanceof FollowsClientError && /not signed in/i.test(err.message)) {
    return new OperationError("not-authenticated", "Sign in to follow members.");
  }
  return new OperationError("follows-failed", err?.message || "the follows request failed");
}
async function getFollows2(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    const r = await getFollows({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.following ?? [];
  } catch (err) {
    throw mapFollowsError(err);
  }
}
async function setFollow2(ctx, { username, on = true } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    const r = await setFollow({ username, on, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.following ?? [];
  } catch (err) {
    throw mapFollowsError(err);
  }
}
async function upvoteContent(ctx, { type = "share", slug, on = true } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    const r = await upvote({ type, slug, on, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { upvoted: !!r?.upvoted, upvoteCount: r?.upvoteCount, enqueued: !!r?.enqueued };
  } catch (err) {
    if (err instanceof UpvoteClientError) throw new OperationError("upvote-failed", err.message);
    throw err;
  }
}
async function ogPreview2(ctx, { url: url2 } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await ogPreview({ url: url2, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    if (err instanceof OgClientError) throw new OperationError("og-preview-failed", err.message);
    throw err;
  }
}
async function getSyndicationQueue2(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  return getSyndicationQueue({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}
async function cancelSyndication2(ctx, { id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  return cancelSyndication({ id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}
async function approveSyndication2(ctx, { id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  return approveSyndication({ id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}
async function getSocialQueue2(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  return getSocialQueue({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}
async function socialQueueAction2(ctx, { action, id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  return socialQueueAction({ action, id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}
async function getSyndicateNowInfo(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  return getSyndicateNow({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}
async function syndicateNow2(ctx, { destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  return syndicateNow({ destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}
async function getNews(ctx, { category, since, limit } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await workerGetNews({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, category, since, limit });
  } catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError("not-authenticated", "Sign in to read the news.");
    if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError("membership-required", "News is a members-only perk. Upgrade at https://gbti.network.");
    throw new OperationError("news-failed", err?.message || "the news request failed");
  }
}
function mapNewsErr(err, what) {
  if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError("not-authenticated", `Sign in to ${what}.`);
  if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError("membership-required", `${what} is a members-only perk. Upgrade at https://gbti.network.`);
  throw new OperationError("news-failed", err?.message || `the ${what} request failed`);
}
async function getNewsSources(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await workerGetNewsSources({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    mapNewsErr(err, "browse news channels");
  }
}
async function getPrefs(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await workerGetPrefs({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    mapNewsErr(err, "read your preferences");
  }
}
async function setPrefs(ctx, { categories, followChannel, publicFavorites } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await workerSetPrefs({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, patch: { categories, followChannel, publicFavorites } });
  } catch (err) {
    mapNewsErr(err, "save your preferences");
  }
}
async function publishNews(ctx, { item } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await workerPublishNews({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, item });
  } catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError("not-authenticated", "Sign in to publish to Discord.");
    if (err instanceof NewsClientError && /curator/i.test(err.message)) throw new OperationError("forbidden", "Publishing news to Discord requires a curator role.");
    throw new OperationError("news-failed", err?.message || "could not publish to Discord");
  }
}
async function reflectNewsDiscussion(ctx, { guid: guid3 } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await workerNewsDiscussed({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, guid: guid3 });
  } catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError("not-authenticated", "Sign in first.");
    if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError("membership-required", "News discussion is a members-only perk.");
    throw new OperationError("news-failed", err?.message || "could not reflect the discussion");
  }
}
async function recordNewsOpen(ctx, { guid: guid3, source } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await workerNewsOpened({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, guid: guid3, source });
  } catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError("not-authenticated", "Sign in first.");
    throw new OperationError("news-failed", err?.message || "could not record the open");
  }
}
async function recordContentOpen(ctx, { type, slug } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    return await workerContentOpened({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, type, slug });
  } catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError("not-authenticated", "Sign in first.");
    throw new OperationError("news-failed", err?.message || "could not record the open");
  }
}
async function getDiscordInvite2(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  try {
    const r = await getDiscordInvite({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { url: r?.url ?? null, source: r?.source ?? null };
  } catch (err) {
    if (err instanceof InviteClientError && /not signed in/i.test(err.message)) {
      throw new OperationError("not-authenticated", "Sign in to get a Discord invite.");
    }
    throw new OperationError("invite-failed", err?.message || "the Discord invite request failed");
  }
}
async function getDiscordLinkUrl(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.("githubToken");
  if (!token) throw new OperationError("not-authenticated", "Sign in to connect Discord.");
  const fetch2 = ctx.fetch ?? globalThis.fetch;
  let res;
  try {
    res = await fetch2(`${SIGNUP_BASE}/discord/link/init`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new OperationError("discord-link-failed", err?.message || "the Discord link request failed");
  }
  if (!res.ok) throw new OperationError("discord-link-failed", `the Discord link request failed (${res.status})`);
  const data = await res.json().catch(() => null);
  if (!data || !data.url) throw new OperationError("discord-link-failed", "no link URL returned");
  return { url: data.url };
}
async function getDiscordLinkStatus(ctx) {
  const token = ctx.store?.get?.("githubToken");
  if (!token) return { linked: false };
  const fetch2 = ctx.fetch ?? globalThis.fetch;
  try {
    const res = await fetch2(`${SIGNUP_BASE}/discord/link/status`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { linked: false };
    const data = await res.json().catch(() => null);
    return { linked: Boolean(data && data.linked) };
  } catch {
    return { linked: false };
  }
}
async function getOnboardingStatus(ctx) {
  const token = ctx.store?.get?.("githubToken");
  const mode = authModeFor(ctx);
  if (mode !== "app") {
    return { appMode: false, mode, signedIn: !!token, forkReady: true, installReady: true, activeStep: token ? "ready" : "signin", ready: !!token, reachedGithub: true };
  }
  const r = await probeReadiness({ token, appSlug: GITHUB_APP_SLUG, upstream: UPSTREAM_REPO, fetch: ctx.fetch ?? globalThis.fetch });
  if (token && r.reachedGithub && !r.signedIn) {
    try {
      ctx.store?.set?.({ githubToken: null, identity: null });
    } catch {
    }
  }
  const activeStep = nextStep(r);
  return {
    appMode: true,
    mode,
    ...r,
    activeStep,
    ready: activeStep === "ready",
    forkName: r.login ? forkFullName(r.login) : null,
    steps: STEPS,
    links: { device: deviceVerificationUrl(), fork: forkUrl(), install: appInstallUrl({ targetId: r.githubId }), manage: manageInstallsUrl() }
  };
}
async function requireAdmin(ctx) {
  const id = requireIdentity(ctx);
  const readText = async (p) => {
    try {
      return await ctx.reader?.readFile?.(p) || "";
    } catch {
      return "";
    }
  };
  const rolesParsed = index_vite_proxy_tmp_default.load(await readText("house/roles.yml")) || {};
  const role = roleOf2(String(id.githubId), rolesFromParsed2(rolesParsed));
  if (!isAdminRole(role)) throw new OperationError("forbidden", `this requires admin (you are ${role})`);
  return { id, role, rolesParsed, readText };
}
async function getOverridesRoster(ctx) {
  const { rolesParsed, readText } = await requireAdmin(ctx);
  const [bansParsed, gfParsed, idxParsed] = await Promise.all([
    readText("house/bans.yml").then((t) => index_vite_proxy_tmp_default.load(t) || {}),
    readText("house/grandfathered.yml").then((t) => index_vite_proxy_tmp_default.load(t) || {}),
    readText("house/members-index.yml").then((t) => index_vite_proxy_tmp_default.load(t) || {})
  ]);
  let stripeStatuses = null;
  let stripeLogins = null;
  try {
    const token = ctx.store?.get?.("githubToken");
    if (token) {
      const r = await getRosterStatuses({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
      stripeStatuses = r?.statuses ?? null;
      stripeLogins = r?.logins ?? null;
    }
  } catch {
    stripeStatuses = null;
    stripeLogins = null;
  }
  return buildRoster({ roles: rolesParsed, bans: bansParsed, grandfathered: gfParsed, membersIndex: idxParsed, stripeStatuses, stripeLogins });
}
async function getOpenPulls(ctx) {
  await requireAdmin(ctx);
  const repo = requireRepo(ctx);
  return { pulls: await repo.listOpenPulls() };
}
async function listDiscordChannels(ctx) {
  const token = ctx.store?.get?.("githubToken");
  const channels = await getDiscordChannels({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  return { channels };
}
async function getCouponUsageOp(ctx) {
  await requireAdmin(ctx);
  const token = ctx.store?.get?.("githubToken");
  if (!token) throw new OperationError("not-authenticated", "sign in first");
  try {
    return await getCouponUsage({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new OperationError("admin-op-failed", err?.message || "could not read coupon usage");
  }
}
async function refreshCouponUntil(ctx) {
  const token = ctx.store?.get?.("githubToken");
  if (!token) return { couponUntil: null };
  const { status, couponUntil } = await fetchStripeStatus({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  if (status === "unknown") throw new OperationError("oracle-unreachable", "the membership oracle did not answer");
  ctx.store?.set?.({ couponUntil: couponUntil ?? null });
  return { couponUntil: couponUntil ?? null };
}
async function triggerAdminOp2(ctx, { action, params } = {}) {
  await requireAdmin(ctx);
  const token = ctx.store?.get?.("githubToken");
  if (!token) throw new OperationError("not-authenticated", "sign in first");
  try {
    return await triggerAdminOp({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, action, params });
  } catch (err) {
    throw new OperationError("admin-op-failed", err?.message || "could not trigger the operation");
  }
}
async function listIncomingContributions(ctx) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const open = await repo.listOpenPulls();
  const myId = id.githubId != null ? String(id.githubId) : null;
  const myLogin = String(id.login || "").toLowerCase();
  const out = [];
  for (const pr of open) {
    const aId = pr.author?.id != null ? String(pr.author.id) : null;
    const aLogin = String(pr.author?.login || "").toLowerCase();
    if (myId && aId && aId === myId || myLogin && aLogin && aLogin === myLogin) continue;
    let files;
    try {
      files = await repo.listPullFiles(pr.number);
    } catch {
      continue;
    }
    const paths = files.map((f2) => f2.filename);
    if (!isContributionToFolder(paths, id.username)) continue;
    out.push({
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      author: pr.author ?? null,
      headSha: pr.headSha ?? null,
      createdAt: pr.createdAt ?? null,
      updatedAt: pr.updatedAt ?? null,
      files,
      fileCount: files.length,
      additions: files.reduce((s, f2) => s + (f2.additions || 0), 0),
      deletions: files.reduce((s, f2) => s + (f2.deletions || 0), 0)
    });
  }
  return { contributions: out };
}
async function loadOwnContribution(ctx, number4) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const n = Number(number4);
  if (!Number.isInteger(n) || n <= 0) throw new OperationError("bad-request", "a positive PR number is required");
  const pr = await repo.getPull(n);
  const aId = pr.author?.id != null ? String(pr.author.id) : null;
  const aLogin = String(pr.author?.login || "").toLowerCase();
  const myId = id.githubId != null ? String(id.githubId) : null;
  const myLogin = String(id.login || "").toLowerCase();
  if (myId && aId && aId === myId || myLogin && aLogin && aLogin === myLogin) {
    throw new OperationError("forbidden", "this is your own pull request, not an incoming contribution");
  }
  const files = await repo.getPullDiffFiles(n);
  if (!isContributionToFolder(files.map((f2) => f2.filename), id.username)) {
    throw new OperationError("forbidden", "this pull request is not a contribution to your folder");
  }
  return { id, repo, n, pr, files };
}
async function getContributionReview(ctx, { number: number4 } = {}) {
  const { repo, n, pr, files } = await loadOwnContribution(ctx, number4);
  const proposed = [];
  for (const f2 of files) {
    if (!/\.md$/i.test(f2.filename) || f2.status === "removed") continue;
    let text = null;
    try {
      text = await repo.getFileContent(f2.filename, pr.headSha);
    } catch {
      text = null;
    }
    if (text == null) continue;
    const { body } = parseContentFile(text);
    proposed.push({ filename: f2.filename, body });
  }
  return {
    number: n,
    title: pr.title,
    html_url: pr.html_url,
    headSha: pr.headSha,
    author: pr.author,
    files: files.map((f2) => ({ filename: f2.filename, status: f2.status, additions: f2.additions, deletions: f2.deletions, patch: f2.patch ?? null })),
    proposed,
    // SOW-028: only the classic account-wide token can post a review the gate honors by the member's
    // github_id. App mode (fork-scoped) and hosted mode (SOW-157, identity-only) both decide on github.com.
    canActInClient: authModeFor(ctx) === "classic"
  };
}
var DECLINE_NOTE = "Thank you for the contribution. The folder owner has decided not to merge this change right now. You are welcome to discuss it here or open a revised proposal.";
async function reviewContribution(ctx, { number: number4, decision, message } = {}) {
  if (authModeFor(ctx) !== "classic") {
    throw new OperationError("forbidden", "approve or decline this contribution on github.com (the gate records your GitHub identity as the reviewer)");
  }
  const { repo, n, pr } = await loadOwnContribution(ctx, number4);
  const msg = typeof message === "string" ? message.trim() : "";
  switch (decision) {
    case "approve":
      await repo.submitReview(n, { event: "APPROVE", body: msg, commitId: pr.headSha });
      return { ok: true, decision, number: n };
    case "request-changes":
      if (!msg) throw new OperationError("bad-request", "request-changes needs a message describing what to change");
      await repo.submitReview(n, { event: "REQUEST_CHANGES", body: msg, commitId: pr.headSha });
      return { ok: true, decision, number: n };
    case "decline":
      await repo.submitReview(n, { event: "REQUEST_CHANGES", body: msg || DECLINE_NOTE, commitId: pr.headSha });
      try {
        await repo.closePull(n);
      } catch {
      }
      return { ok: true, decision, number: n };
    default:
      throw new OperationError("bad-request", `unknown decision "${decision}" (approve | request-changes | decline)`);
  }
}
var IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
function itemImagesDir(itemPath, username) {
  const p = String(itemPath || "").replace(/^\/+/, "");
  if (!p || p.includes("..") || p.includes("\\")) return null;
  const folder = p.replace(/\/[^/]*$/, "");
  if (!folder || folder === p) return null;
  const inOwn = !!username && folder.startsWith(`members/${username}/`);
  const inNetwork = folder.startsWith(`members/${NETWORK_CONTENT_OWNER}/`) || folder === "house" || folder.startsWith("house/");
  if (!inOwn && !inNetwork) return null;
  return `${folder}/images`;
}
function stageImage(ctx, { filename, dataBase64, itemPath } = {}) {
  const id = requireIdentity(ctx);
  if (!ctx.stager) throw new OperationError("bad-request", "Image upload is not available in this client yet.");
  if (!filename || /[\\/]/.test(filename) || filename.includes("..")) throw new OperationError("bad-request", "invalid filename");
  if (!IMAGE_EXT.test(filename)) throw new OperationError("bad-request", "unsupported image type (png/jpg/gif/webp/svg)");
  if (!dataBase64) throw new OperationError("bad-request", "no image data");
  const dir = itemImagesDir(itemPath, id.username);
  if (dir) {
    const rel2 = `${dir}/${filename}`;
    ctx.stager.writeImage(rel2, dataBase64);
    return { ok: true, path: `./images/${filename}`, repoPath: rel2 };
  }
  const rel = `members/${id.username}/images/${filename}`;
  ctx.stager.writeImage(rel, dataBase64);
  return { ok: true, path: rel, repoPath: rel };
}

// client/src/account-ops.mjs
var SITE_BASE = globalThis.process?.env?.GBTI_SITE_BASE || "https://gbti.network";
var BILLING_PORTAL = globalThis.process?.env?.GBTI_BILLING_PORTAL || "https://billing.stripe.com/p/login/cN23cvdQF4b0eTC000";
function getBilling(ctx) {
  return {
    portal: BILLING_PORTAL,
    status: ctx.store?.get("status") ?? null,
    // cached derived status, when present
    note: "Manage your membership (update card, cancel, invoices) in the Stripe customer portal."
  };
}
function getReferral(ctx) {
  const id = ctx.identity?.();
  const code = id?.githubId ?? null;
  return {
    code,
    link: code ? `${SITE_BASE}/join?ref=${code}` : null,
    invitePct: "10%",
    connectOnboarding: `${SIGNUP_BASE}/referral/connect/start`,
    terms: `${SITE_BASE}/referral-terms/`,
    note: "Share your invite link to earn a flat 10% lifetime commission on every member who joins through it. You also earn from your published work: 30% when it is the first content that brought a member in, and 10% when it is the last. Earnings and payout status appear here once payouts are enabled."
  };
}

// client/src/form-fields.mjs
var f = (key, label, kind, extra = {}) => ({ key, label, kind, ...extra });
var STATUS2 = f("status", "Status", "enum", { options: ["draft", "published"] });
var VISIBILITY2 = f("visibility", "Visibility", "enum", { options: ["public", "members"] });
var TAGS = f("tags", "Tags", "array", { placeholder: "comma,separated" });
var FIELDS = Object.freeze({
  post: [
    f("title", "Title", "text", { required: true }),
    f("slug", "Slug", "text", { required: true, placeholder: "kebab-case" }),
    STATUS2,
    VISIBILITY2,
    f("publicStub", "Public stub (when members-only)", "boolean"),
    // SOW-016: true = a public stub page; false = no public page
    f("excerpt", "Excerpt", "textarea"),
    f("categories", "Categories", "array"),
    TAGS,
    // sow-179/sow-183: which of the three article layouts renders this post. Defaults to journal (see
    // src/content.config.ts); editorial and card are the other two, see src/components/blog/Article*.astro.
    f("layout", "Layout", "enum", { options: ["editorial", "journal", "card"], hint: "How this article page is laid out. Editorial: full-width cover hero. Journal: sticky rail beside a single reading column. Card: a centered card, no rail." }),
    f("coverImage", "Cover image", "image"),
    f("coverAlt", "Cover image alt text", "text", { placeholder: "Describe the image for screen readers" }),
    f("video", "Video (YouTube/Vimeo URL)", "text"),
    f("featured", "Featured", "boolean"),
    f("publishedAt", "Published at", "date"),
    f("canonicalUrl", "Canonical URL", "text")
  ],
  product: [
    f("title", "Title", "text", { required: true }),
    f("slug", "Slug", "text", { required: true, placeholder: "kebab-case" }),
    f("shortDescription", "Short description", "textarea", { required: true }),
    f("categories", "Categories", "array", { placeholder: "devops, frameworks, wordpress" }),
    STATUS2,
    VISIBILITY2,
    f("publicStub", "Public stub (when members-only)", "boolean"),
    // SOW-016
    f("pricing", "Pricing", "enum", { options: ["free", "freemium", "paid"] }),
    f("pricingUrl", "Pricing/upgrade URL", "text"),
    f("version", "Version", "text"),
    TAGS,
    f("platforms", "Platforms", "array"),
    // Per-field aspect ratios, taken from what each render surface actually asks for rather than one shared
    // 4:3/Hero toggle. `frame` locks the editor preview so it cannot misrepresent the crop. Icon is square and
    // small, so it also carries the two real display sizes.
    f("icon", "Icon (small, 1:1)", "image", { required: true, frame: "1/1", previewPx: 96, hint: "Square. Rendered at 56 on cards and 96 on the product page. 128x128 or larger." }),
    f("iconLarge", "Icon (large, 1:1)", "image", { frame: "1/1", previewPx: 96, hint: "Optional crisper square for the 96px product-page slot on high-density screens. 192x192 or 256x256." }),
    f("featuredImage", "Featured cover (spotlight)", "image", { required: true, frame: "16/10", hint: "Represents this product wherever it is linked: the homepage, feed cards, and social/link previews (the og:image). Also the page hero if you set no banner. Must be 16:10 (1280x800), it fills the spotlight box without cropping." }),
    f("banner", "Banner", "image", { frame: "3/1", hint: "Only the wide strip behind the title at the top of THIS product page. Optional, or pick a Banner color instead. 3:1 (1200x400), cropped to fill." }),
    // sow-174: a curated color alternative to uploading a banner image, mutually exclusive with `banner` in
    // the editor (rendered as its own swatch row folded into the banner field, not a generic dropdown).
    f("bannerPreset", "Banner color", "enum", { options: BANNER_PRESET_KEYS }),
    // sow-172/174: gallery entries carry optional captions, so this is `json`, not `array` -- `array` coerces
    // through String(), which would flatten a captioned entry to "[object Object]" and destroy the caption
    // the first time an author re-saved a captioned product.
    f("gallery", 'Gallery (JSON array of "image.png" or {src,caption})', "json", { placeholder: '["./images/shot-1.webp", {"src": "./images/shot-2.webp", "caption": "The settings panel"}]' }),
    f("galleryStyle", "Gallery style", "enum", { options: ["grid", "carousel"], hint: "Leave unset to pick by count: 6 or more screenshots use the carousel, fewer use the captioned grid." }),
    f("sidebarPosition", "Sidebar position", "enum", { options: ["left", "right"], hint: "Which side the Contents rail renders on for this product page." }),
    f("video", "Video (YouTube/Vimeo URL)", "text"),
    f("links", "Links (JSON array: {type,url,visibility:public|members,primary,label})", "json"),
    f("publishedAt", "Published at", "date")
  ],
  prompt: [
    f("title", "Title", "text", { required: true }),
    f("slug", "Slug", "text", { required: true, placeholder: "kebab-case" }),
    f("shortDescription", "Short description", "textarea", { required: true }),
    // SOW-025: required by the schema (one-liner on cards + the feed)
    f("categories", "Categories", "array", { placeholder: "devops, accessibility" }),
    STATUS2,
    VISIBILITY2,
    f("publicStub", "Public stub (when members-only)", "boolean"),
    // SOW-016
    f("pricing", "Pricing", "enum", { options: ["free", "freemium", "paid"] }),
    f("targets", "Targets (models/tools)", "array"),
    TAGS,
    f("variables", "Variables", "array"),
    f("exampleOutput", "Example output", "textarea"),
    // Result image: shown ONLY when a target is an image generator (Nano Banana, MidJourney, etc.). The
    // `showIf` is serializable data the form renderer evaluates live as the targets field changes; the
    // schema + content validator enforce the same rule server-side.
    f("image", "Result image (image-gen models, recommended 4:3)", "image", { placeholder: "1200x900 (4:3) crops cleanest", showIf: { field: "targets", includesModel: IMAGE_GEN_MODELS } }),
    f("sourceUrl", "Source URL", "text"),
    f("links", "Links (JSON array: {type,url,visibility:public|members,primary,label})", "json"),
    f("publishedAt", "Published at", "date")
  ],
  profile: [
    f("displayName", "Display name", "text", { required: true }),
    STATUS2,
    VISIBILITY2,
    f("headline", "Headline", "text"),
    f("avatar", "Avatar", "image"),
    f("location", "Location", "text"),
    f("forHire", "For hire", "boolean"),
    f("directory", "List in member directory", "boolean"),
    f("skills", "Skills", "array"),
    f("roles", "Roles", "array"),
    f("links", "Links (JSON: github/website/x/linkedin/…)", "json")
  ]
});
function fieldsFor(type) {
  return FIELDS[type] ?? null;
}

// client/src/video-embed.mjs
function embedUrl(v) {
  const s = String(v || "").trim();
  let m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  m = s.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/);
  if (m) return `https://www.tiktok.com/embed/v2/${m[1]}`;
  m = s.match(/rumble\.com\/embed\/([a-z0-9]+)/i);
  if (m) return `https://rumble.com/embed/${m[1]}/`;
  if (/^[\w-]{11}$/.test(s)) return `https://www.youtube.com/embed/${s}`;
  if (/^\d+$/.test(s)) return `https://player.vimeo.com/video/${s}`;
  return null;
}

// client/src/markdown.mjs
var EMBED_RELAY = "https://gbti.network/embed/";
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
var REL_ALLOWED = /* @__PURE__ */ new Set(["nofollow", "noopener", "noreferrer"]);
var DANGEROUS_SCHEME = /^\s*(?:javascript|data|vbscript):/i;
function decodeEntities(s) {
  let p = String(s ?? "");
  for (let i = 0; i < 4; i++) {
    const n = p.replace(/&#x([0-9a-f]+);?/gi, (_m, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return "";
      }
    }).replace(/&#(\d+);?/g, (_m, d) => {
      try {
        return String.fromCodePoint(parseInt(d, 10));
      } catch {
        return "";
      }
    }).replace(/&amp;/gi, "&");
    if (n === p) break;
    p = n;
  }
  return p;
}
var isDangerousAnchorHref = (url2) => {
  const decoded = decodeEntities(url2).replace(/[\x00-\x20]+/g, "");
  return DANGEROUS_SCHEME.test(decoded) || DANGEROUS_SCHEME.test(String(url2 ?? ""));
};
var attrOf = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(String(attrs || ""));
  return m ? m[1] : "";
};
var escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function emphasis(t) {
  return String(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}
var SAFE_INNER_TAG = /^(?:strong|b|em|i|code|s|del|br)$/i;
var sanitizeAnchorInner = (html) => String(html ?? "").replace(
  /<(\/?)([a-z][a-z0-9]*)(?:\s[^>]*)?>/gi,
  (_m, slash, tag) => SAFE_INNER_TAG.test(tag) ? `<${slash}${tag.toLowerCase()}>` : ""
);
function rawAnchorHtml(attrs, inner) {
  const href = decodeEntities(attrOf(attrs, "href"));
  if (!href || isDangerousAnchorHref(href)) return emphasis(sanitizeAnchorInner(inner));
  const rel = [];
  for (const tok of attrOf(attrs, "rel").toLowerCase().split(/\s+/)) if (REL_ALLOWED.has(tok) && !rel.includes(tok)) rel.push(tok);
  const blank = attrOf(attrs, "target").toLowerCase() === "_blank";
  if (blank && !rel.includes("noopener")) rel.push("noopener");
  const relAttr = rel.length ? ` rel="${rel.join(" ")}"` : "";
  const tgtAttr = blank ? ' target="_blank"' : "";
  return `<a href="${escAttr(href)}"${relAttr}${tgtAttr}>${emphasis(sanitizeAnchorInner(inner))}</a>`;
}
function escapeKeepingLinks(s, keep) {
  const stripped = String(s ?? "").replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs, inner) => {
    keep.push(rawAnchorHtml(attrs, inner));
    return `${keep.length - 1}`;
  });
  return escapeHtml(stripped);
}
var FN_ID = "[A-Za-z0-9_-]+";
function collectFootnoteIds(lines) {
  const ids = /* @__PURE__ */ new Set();
  let fence = 0;
  for (const line of lines) {
    const f2 = /^(`{3,})(.*)$/.exec(line);
    if (f2) {
      if (!fence) fence = f2[1].length;
      else if (f2[1].length >= fence && !f2[2].trim()) fence = 0;
      continue;
    }
    if (fence) continue;
    const d = new RegExp(`^\\[\\^(${FN_ID})\\]:`).exec(line);
    if (d) ids.add(d[1]);
  }
  return ids;
}
function inline(escaped, fn = null) {
  let t = escaped;
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `${codes.length - 1}`;
  });
  if (fn) {
    t = t.replace(new RegExp(`\\[\\^(${FN_ID})\\](?!:)`, "g"), (m, id) => {
      if (!fn.ids.has(id)) return m;
      const n = (fn.counts.get(id) ?? 0) + 1;
      fn.counts.set(id, n);
      return `<sup class="md-fnref"><a href="#fn-${id}" id="fnref-${id}${n > 1 ? `-${n}` : ""}">${id}</a></sup>`;
    });
  }
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+|\.?\/[^\s)]+)\)/g, (_m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt, url2) => `<a href="${url2}" target="_blank" rel="noopener">${txt}</a>`);
  t = emphasis(t);
  t = t.replace(/\uE000(\d+)\uE001/g, (_m, i) => `<code>${codes[Number(i)] ?? ""}</code>`);
  return t;
}
function codeOpen(lang) {
  const tag = String(lang || "").trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
  return tag ? `<pre><code class="language-${tag}" data-lang="${tag}">` : "<pre><code>";
}
var CALLOUT_VARIANTS = ["info", "note", "warning", "tip"];
function renderFence(lang, buf, fn = null) {
  const info = String(lang || "").trim().split(/\s+/);
  const body = buf.join("\n");
  if (info[0] === "callout") {
    const v = CALLOUT_VARIANTS.includes(info[1]) ? info[1] : "note";
    const html = body.split("\n").map((l) => inline(escapeHtml(l), fn)).join("<br/>");
    return `<div class="md-callout md-callout-${v}"><div class="md-callout-body">${html}</div></div>`;
  }
  if (info[0] === "embed") {
    const url2 = body.trim();
    const src = embedUrl(url2);
    if (src) return `<div class="md-embed"><iframe src="${escapeHtml(`${EMBED_RELAY}?u=${encodeURIComponent(url2)}`)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen title="Embedded video"></iframe></div>`;
    return `<p><a href="${escapeHtml(url2)}" target="_blank" rel="noopener">${escapeHtml(url2)}</a></p>`;
  }
  return `${codeOpen(lang)}${escapeHtml(body)}</code></pre>`;
}
function splitTableRow(line) {
  const s = String(line).trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
function tableAlignments(line) {
  if (!/\|/.test(String(line ?? ""))) return null;
  const cells = splitTableRow(line);
  if (!cells.length || cells.some((c) => !/^:?-+:?$/.test(c))) return null;
  return cells.map((c) => c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : "");
}
function renderMarkdown(md) {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let codeFence = 3;
  let inCode = false;
  let codeBuf = [];
  let codeLang = "";
  let listType = null;
  let listBuf = [];
  const footnotes = [];
  const fn = { ids: collectFootnoteIds(lines), counts: /* @__PURE__ */ new Map() };
  const linkKeep = [];
  const flushList = () => {
    if (listType) {
      out.push(`<${listType}>${listBuf.join("")}</${listType}>`);
      listType = null;
      listBuf = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^(`{3,})(.*)$/.exec(line);
    if (fence) {
      if (!inCode) {
        inCode = true;
        codeBuf = [];
        codeFence = fence[1].length;
        codeLang = fence[2];
        i++;
        continue;
      }
      if (fence[1].length >= codeFence && !fence[2].trim()) {
        inCode = false;
        flushList();
        out.push(renderFence(codeLang, codeBuf, fn));
        codeLang = "";
        i++;
        continue;
      }
      codeBuf.push(line);
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }
    const def = new RegExp(`^\\[\\^(${FN_ID})\\]:\\s?(.*)$`).exec(line);
    if (def) {
      flushList();
      const parts = [def[2].trim()];
      i++;
      while (i < lines.length && /^ {4,}\S/.test(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      footnotes.push({ id: def[1], html: parts.map((p) => inline(escapeHtml(p), fn)).join("<br/>") });
      continue;
    }
    const esc2 = escapeKeepingLinks(line, linkKeep);
    let m;
    if (m = /^(#{1,6})\s+(.*)$/.exec(esc2)) {
      flushList();
      out.push(`<h${m[1].length}>${inline(m[2], fn)}</h${m[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listBuf.push(`<li>${inline(escapeKeepingLinks(line.replace(/^\s*[-*]\s+/, ""), linkKeep), fn)}</li>`);
      i++;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listBuf.push(`<li>${inline(escapeKeepingLinks(line.replace(/^\s*\d+\.\s+/, ""), linkKeep), fn)}</li>`);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushList();
      out.push(`<blockquote>${inline(escapeKeepingLinks(line.replace(/^\s*>\s?/, ""), linkKeep), fn)}</blockquote>`);
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flushList();
      out.push("<hr/>");
      i++;
      continue;
    }
    const aligns = i + 1 < lines.length ? tableAlignments(lines[i + 1]) : null;
    if (aligns && line.includes("|")) {
      flushList();
      const cell = (c) => inline(escapeKeepingLinks(c, linkKeep), fn);
      const cols = (row, tag) => row.map((c, n) => `<${tag}${aligns[n] ? ` style="text-align:${aligns[n]}"` : ""}>${cell(c)}</${tag}>`).join("");
      const head = `<thead><tr>${cols(splitTableRow(line), "th")}</tr></thead>`;
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const body = rows.length ? `<tbody>${rows.map((r) => `<tr>${cols(r, "td")}</tr>`).join("")}</tbody>` : "";
      out.push(`<table>${head}${body}</table>`);
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushList();
      i++;
      continue;
    }
    flushList();
    const para = [esc2];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !new RegExp(`^(#{1,6})\\s|^\\s*[-*]\\s|^\\s*\\d+\\.\\s|^\`\`\`|^\\s*>|^\\[\\^${FN_ID}\\]:`).test(lines[i])) {
      para.push(escapeKeepingLinks(lines[i], linkKeep));
      i++;
    }
    out.push(`<p>${inline(para.join(" "), fn)}</p>`);
  }
  flushList();
  if (inCode) out.push(renderFence(codeLang, codeBuf, fn));
  const referenced = footnotes.filter((f2) => (fn.counts.get(f2.id) ?? 0) > 0);
  if (referenced.length) {
    const items = referenced.map((f2) => {
      const n = fn.counts.get(f2.id);
      const backs = Array.from({ length: n }, (_v, k) => `<a class="md-fn-back" href="#fnref-${f2.id}${k ? `-${k + 1}` : ""}" aria-label="Back to reference${k ? ` ${k + 1}` : ""}">&#8617;${k ? `<sup>${k + 1}</sup>` : ""}</a>`).join(" ");
      return `<li id="fn-${f2.id}">${f2.html} ${backs}</li>`;
    }).join("");
    out.push(`<section class="md-footnotes"><h2>Footnotes</h2><ol>${items}</ol></section>`);
  }
  const joined = out.join("\n");
  return linkKeep.length ? joined.replace(/(\d+)/g, (_m, i2) => linkKeep[Number(i2)] ?? "") : joined;
}

// membership/superadmin-actions.mjs
var SuperadminActionError = class extends Error {
};
var idOf2 = (e) => String(e?.github_id ?? "");
var ROLE_LIST = Object.freeze({ [ROLE2.superadmin]: "superadmins", [ROLE2.admin]: "admins", [ROLE2.moderator]: "moderators" });
var ALL_LISTS = ["superadmins", "admins", "moderators"];
function reqId(githubId) {
  const id = githubId != null ? String(githubId) : "";
  if (!id) throw new SuperadminActionError("githubId is required");
  return id;
}
function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new SuperadminActionError("invalid timestamp");
  return d.toISOString();
}
function audit({ actor, action, target, detail = null, now } = {}) {
  return {
    at: isoOf(now),
    actor: actor ? { github_id: actor.githubId != null ? String(actor.githubId) : actor.github_id != null ? String(actor.github_id) : null, login: actor.login ?? null } : null,
    action,
    target: target ? { github_id: target.githubId != null ? String(target.githubId) : null, login: target.login ?? null } : null,
    detail
  };
}
var cloneList = (list) => Array.isArray(list) ? list.map((e) => structuredClone(e)) : [];
var reasonOr = (reason, fallback) => reason && String(reason).trim() || fallback;
var cloneRoles = (r) => ({ superadmins: cloneList(r?.superadmins), admins: cloneList(r?.admins), moderators: cloneList(r?.moderators), ...stripLists(r) });
function stripLists(r) {
  const o = { ...r || {} };
  for (const l of ALL_LISTS) delete o[l];
  return o;
}
function grantRole(parsedRoles, { githubId, login, role = ROLE2.member }, ctx = {}) {
  const id = reqId(githubId);
  if (role !== ROLE2.member && !ROLE_LIST[role]) throw new SuperadminActionError(`unknown role: ${role}`);
  const next = cloneRoles(parsedRoles);
  let changed = false;
  for (const list of ALL_LISTS) {
    const target = ROLE_LIST[role] === list;
    const has = next[list].some((e) => idOf2(e) === id);
    if (target && !has) {
      next[list].push({ github_id: id, ...login ? { login } : {} });
      changed = true;
    } else if (!target && has) {
      next[list] = next[list].filter((e) => idOf2(e) !== id);
      changed = true;
    }
  }
  return { next, changed, audit: audit({ ...ctx, action: "role.grant", target: { githubId: id, login }, detail: { role } }) };
}
function ban(parsedBans, { githubId, login, reason }, ctx = {}) {
  const id = reqId(githubId);
  const list = cloneList(parsedBans?.bans);
  if (list.some((e) => idOf2(e) === id)) {
    return { next: { ...parsedBans || {}, bans: list }, changed: false, audit: audit({ ...ctx, action: "ban", target: { githubId: id, login }, detail: { reason: reason ?? null, alreadyBanned: true } }) };
  }
  const r = reasonOr(reason, "banned");
  list.push({ github_id: id, ...login ? { login } : {}, reason: r, at: isoOf(ctx.now) });
  return { next: { ...parsedBans || {}, bans: list }, changed: true, audit: audit({ ...ctx, action: "ban", target: { githubId: id, login }, detail: { reason: r } }) };
}
function unban(parsedBans, { githubId, login }, ctx = {}) {
  const id = reqId(githubId);
  const list = cloneList(parsedBans?.bans);
  const next = list.filter((e) => idOf2(e) !== id);
  return { next: { ...parsedBans || {}, bans: next }, changed: next.length !== list.length, audit: audit({ ...ctx, action: "unban", target: { githubId: id, login } }) };
}
function grandfather(parsedGf, { githubId, login, reason, until = null }, ctx = {}) {
  const id = reqId(githubId);
  if (until != null && until !== "" && Number.isNaN(new Date(until).getTime())) throw new SuperadminActionError("invalid until date");
  const list = cloneList(parsedGf?.grandfathered);
  const i = list.findIndex((e) => idOf2(e) === id);
  const at = i >= 0 && list[i]?.at ? list[i].at : isoOf(ctx.now);
  const entry = { github_id: id, ...login ? { login } : {}, reason: reasonOr(reason, "complimentary access"), until: until ?? null, at };
  let changed;
  if (i >= 0) {
    changed = JSON.stringify(list[i]) !== JSON.stringify(entry);
    list[i] = entry;
  } else {
    list.push(entry);
    changed = true;
  }
  return { next: { ...parsedGf || {}, grandfathered: list }, changed, audit: audit({ ...ctx, action: "grandfather", target: { githubId: id, login }, detail: { reason: reason ?? null, until: until ?? null } }) };
}
function revokeGrandfather(parsedGf, { githubId, login }, ctx = {}) {
  const id = reqId(githubId);
  const list = cloneList(parsedGf?.grandfathered);
  const next = list.filter((e) => idOf2(e) !== id);
  return { next: { ...parsedGf || {}, grandfathered: next }, changed: next.length !== list.length, audit: audit({ ...ctx, action: "grandfather.revoke", target: { githubId: id, login } }) };
}

// membership/taxonomy-edits.mjs
var TaxonomyEditError = class extends Error {
};
var KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var MAX_LABEL = 60;
function isoOf2(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new TaxonomyEditError("invalid timestamp");
  return d.toISOString();
}
function auditEntry(ctx, action, path, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf2(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : a.github_id != null ? String(a.github_id) : null, login: a.login ?? null } : null,
    action,
    target: { path: [...path] },
    detail: detail ?? null
  };
}
function nodeAt(taxonomy, path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let map2 = taxonomy?.tree;
  let node = null;
  for (const key of path) {
    if (!map2 || typeof map2 !== "object") return null;
    node = map2[key];
    if (!node || typeof node !== "object") return null;
    map2 = node.children;
  }
  return node;
}
function cleanLabel(label) {
  const lab = typeof label === "string" ? label.trim() : "";
  if (!lab) throw new TaxonomyEditError("a category label is required");
  return lab.slice(0, MAX_LABEL);
}
function cleanTaxonomy(taxonomy) {
  const tx = structuredClone(taxonomy && typeof taxonomy === "object" ? taxonomy : {});
  if (!tx.tree || typeof tx.tree !== "object" || Array.isArray(tx.tree)) tx.tree = {};
  return tx;
}
function addCategory(taxonomy, { parentPath = [], key, label } = {}, ctx = {}) {
  const tx = cleanTaxonomy(taxonomy);
  const k = typeof key === "string" ? key.trim() : "";
  if (!KEY_RE.test(k)) throw new TaxonomyEditError("a category key must be kebab-case (lowercase letters, digits, single hyphens)");
  const lab = cleanLabel(label);
  let childrenMap;
  if (Array.isArray(parentPath) && parentPath.length) {
    const parent = nodeAt(tx, parentPath);
    if (!parent) throw new TaxonomyEditError(`parent category not found: ${parentPath.join(" > ")}`);
    if (!parent.children || typeof parent.children !== "object" || Array.isArray(parent.children)) parent.children = {};
    childrenMap = parent.children;
  } else {
    childrenMap = tx.tree;
  }
  const fullPath = [...Array.isArray(parentPath) ? parentPath : [], k];
  const existing = childrenMap[k];
  if (existing) {
    if ((existing.label ?? "") === lab) return { next: tx, changed: false, audit: auditEntry(ctx, "taxonomy.add", fullPath, { label: lab, noop: true }) };
    throw new TaxonomyEditError(`a category "${k}" already exists here; use rename to change its label`);
  }
  childrenMap[k] = { label: lab };
  return { next: tx, changed: true, audit: auditEntry(ctx, "taxonomy.add", fullPath, { label: lab }) };
}
function renameLabel(taxonomy, { path, label } = {}, ctx = {}) {
  const tx = cleanTaxonomy(taxonomy);
  if (!Array.isArray(path) || path.length === 0) throw new TaxonomyEditError("a category path is required");
  const lab = cleanLabel(label);
  const node = nodeAt(tx, path);
  if (!node) throw new TaxonomyEditError(`category not found: ${path.join(" > ")}`);
  if ((node.label ?? "") === lab) return { next: tx, changed: false, audit: auditEntry(ctx, "taxonomy.rename", path, { label: lab, noop: true }) };
  node.label = lab;
  return { next: tx, changed: true, audit: auditEntry(ctx, "taxonomy.rename", path, { label: lab }) };
}

// membership/news-source-edits.mjs
var NewsSourceEditError = class extends Error {
};
var ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var MAX_NAME = 80;
var MAX_DESC = 120;
function isoOf3(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new NewsSourceEditError("invalid timestamp");
  return d.toISOString();
}
function auditEntry2(ctx, action, id, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf3(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : a.github_id != null ? String(a.github_id) : null, login: a.login ?? null } : null,
    action,
    target: { id },
    detail: detail ?? null
  };
}
function hostOf(url2) {
  try {
    return new URL(url2).hostname;
  } catch {
    return String(url2 || "").replace(/^https?:\/\//i, "").split("/")[0] || "";
  }
}
function slugify2(name, url2 = "") {
  let s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) s = hostOf(url2).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 60).replace(/-+$/g, "");
}
function clean(doc) {
  const d = structuredClone(doc && typeof doc === "object" ? doc : {});
  if (!Array.isArray(d.sources)) d.sources = [];
  return d;
}
var normUrl = (u) => String(u || "").trim();
function addSource(doc, { id, name, url: url2, description, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const nm = String(name || "").trim().slice(0, MAX_NAME);
  const u = normUrl(url2);
  if (!nm) throw new NewsSourceEditError("a source name is required");
  if (!/^https?:\/\//i.test(u)) throw new NewsSourceEditError("a source needs an http(s) feed url");
  const sid = typeof id === "string" && id.trim() ? id.trim() : slugify2(nm, u);
  if (!ID_RE.test(sid)) throw new NewsSourceEditError("the source id must be kebab-case (lowercase letters, digits, single hyphens)");
  const byId = d.sources.find((s) => s.id === sid);
  const byUrl = d.sources.find((s) => normUrl(s.url) === u);
  if (byId) {
    if (normUrl(byId.url) === u) return { next: d, changed: false, audit: auditEntry2(ctx, "news-source.add", sid, { url: u, noop: true }) };
    throw new NewsSourceEditError(`a source "${sid}" already exists with a different url; pick another id`);
  }
  if (byUrl) throw new NewsSourceEditError(`that feed url is already in the pool as "${byUrl.id}"`);
  const desc = String(description ?? "").trim().slice(0, MAX_DESC) || hostOf(u);
  d.sources.push({ id: sid, name: nm, url: u, description: desc, enabled: enabled !== false });
  return { next: d, changed: true, audit: auditEntry2(ctx, "news-source.add", sid, { name: nm, url: u }) };
}
function setSourceEnabled(doc, { id, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const sid = String(id || "").trim();
  const want = enabled !== false;
  const s = d.sources.find((x) => x.id === sid);
  if (!s) throw new NewsSourceEditError(`source not found: ${sid}`);
  if (s.enabled !== false === want) return { next: d, changed: false, audit: auditEntry2(ctx, "news-source.enable", sid, { enabled: want, noop: true }) };
  s.enabled = want;
  return { next: d, changed: true, audit: auditEntry2(ctx, "news-source.enable", sid, { enabled: want }) };
}
function removeSource(doc, { id } = {}, ctx = {}) {
  const d = clean(doc);
  const sid = String(id || "").trim();
  const i = d.sources.findIndex((x) => x.id === sid);
  if (i < 0) throw new NewsSourceEditError(`source not found: ${sid}`);
  d.sources.splice(i, 1);
  return { next: d, changed: true, audit: auditEntry2(ctx, "news-source.remove", sid, null) };
}

// membership/quote-edits.mjs
var QuoteEditError = class extends Error {
};
var MAX_TEXT = 280;
var MAX_AUTHOR = 80;
var normText = (t) => String(t || "").trim();
var keyOf = (t) => normText(t).toLowerCase();
function isoOf4(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new QuoteEditError("invalid timestamp");
  return d.toISOString();
}
function auditEntry3(ctx, action, text, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf4(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : a.github_id != null ? String(a.github_id) : null, login: a.login ?? null } : null,
    action,
    target: { text },
    detail: detail ?? null
  };
}
function clean2(doc) {
  const d = structuredClone(doc && typeof doc === "object" ? doc : {});
  if (!Array.isArray(d.quotes)) d.quotes = [];
  return d;
}
function addQuote(doc, { text, author, enabled } = {}, ctx = {}) {
  const d = clean2(doc);
  const t = normText(text).slice(0, MAX_TEXT);
  const a = normText(author).slice(0, MAX_AUTHOR);
  if (!t) throw new QuoteEditError("a quote needs text");
  if (!a) throw new QuoteEditError("a quote needs an author");
  const exists = d.quotes.find((q) => keyOf(q.text) === keyOf(t));
  if (exists) return { next: d, changed: false, audit: auditEntry3(ctx, "quote.add", t, { noop: true }) };
  d.quotes.push({ text: t, author: a, enabled: enabled !== false });
  return { next: d, changed: true, audit: auditEntry3(ctx, "quote.add", t, { author: a }) };
}
function setQuoteEnabled(doc, { text, enabled } = {}, ctx = {}) {
  const d = clean2(doc);
  const want = enabled !== false;
  const q = d.quotes.find((x) => keyOf(x.text) === keyOf(text));
  if (!q) throw new QuoteEditError(`quote not found: ${normText(text)}`);
  if (q.enabled !== false === want) return { next: d, changed: false, audit: auditEntry3(ctx, "quote.enable", q.text, { enabled: want, noop: true }) };
  q.enabled = want;
  return { next: d, changed: true, audit: auditEntry3(ctx, "quote.enable", q.text, { enabled: want }) };
}
function removeQuote(doc, { text } = {}, ctx = {}) {
  const d = clean2(doc);
  const i = d.quotes.findIndex((x) => keyOf(x.text) === keyOf(text));
  if (i < 0) throw new QuoteEditError(`quote not found: ${normText(text)}`);
  const [gone] = d.quotes.splice(i, 1);
  return { next: d, changed: true, audit: auditEntry3(ctx, "quote.remove", gone?.text ?? normText(text), null) };
}

// membership/content-channels-edits.mjs
var ContentChannelEditError = class extends Error {
};
var KEY_RE2 = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var CHANNEL_ID_RE = /^[0-9]{5,25}$/;
function isoOf5(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new ContentChannelEditError("invalid timestamp");
  return d.toISOString();
}
function auditEntry4(ctx, action, category, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf5(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : a.github_id != null ? String(a.github_id) : null, login: a.login ?? null } : null,
    action,
    target: { category },
    detail: detail ?? null
  };
}
function clean3(doc) {
  const d = structuredClone(doc && typeof doc === "object" ? doc : {});
  if (!Array.isArray(d.channels)) d.channels = [];
  return d;
}
function setChannel(doc, { category, channelId } = {}, ctx = {}) {
  const d = clean3(doc);
  const cat = String(category || "").trim().toLowerCase();
  const ch = String(channelId || "").trim();
  if (!KEY_RE2.test(cat)) throw new ContentChannelEditError("the category must be a kebab-case key (a topic key or a top-level taxonomy key)");
  if (!CHANNEL_ID_RE.test(ch)) throw new ContentChannelEditError("the channelId must be a numeric Discord channel id");
  const existing = d.channels.find((e) => String(e?.category || "").trim().toLowerCase() === cat);
  if (existing) {
    if (String(existing.channelId ?? "").trim() === ch) return { next: d, changed: false, audit: auditEntry4(ctx, "content-channel.set", cat, { channelId: ch, noop: true }) };
    existing.channelId = ch;
    return { next: d, changed: true, audit: auditEntry4(ctx, "content-channel.set", cat, { channelId: ch, updated: true }) };
  }
  d.channels.push({ category: cat, channelId: ch });
  d.channels.sort((a, b) => String(a.category).localeCompare(String(b.category)));
  return { next: d, changed: true, audit: auditEntry4(ctx, "content-channel.set", cat, { channelId: ch }) };
}
function removeChannel(doc, { category } = {}, ctx = {}) {
  const d = clean3(doc);
  const cat = String(category || "").trim().toLowerCase();
  const i = d.channels.findIndex((e) => String(e?.category || "").trim().toLowerCase() === cat);
  if (i < 0) throw new ContentChannelEditError(`no channel mapping for category: ${cat}`);
  d.channels.splice(i, 1);
  return { next: d, changed: true, audit: auditEntry4(ctx, "content-channel.remove", cat, null) };
}

// membership/moderation-flags-edits.mjs
var ModerationFlagEditError = class extends Error {
};
var LIST_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var MAX_TERM = 64;
function isoOf6(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new ModerationFlagEditError("invalid timestamp");
  return d.toISOString();
}
function auditEntry5(ctx, action, list, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf6(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : a.github_id != null ? String(a.github_id) : null, login: a.login ?? null } : null,
    action,
    target: { list },
    detail: detail ?? null
  };
}
function clean4(doc) {
  const d = structuredClone(doc && typeof doc === "object" ? doc : {});
  if (!d.lists || typeof d.lists !== "object" || Array.isArray(d.lists)) d.lists = {};
  for (const [name, terms] of Object.entries(d.lists)) {
    if (!Array.isArray(terms)) d.lists[name] = [];
  }
  return d;
}
var normTerm = (t) => String(t || "").replace(/\s+/g, " ").trim();
function requireListAndTerm(d, list, term) {
  const name = String(list || "").trim();
  if (!LIST_RE.test(name)) throw new ModerationFlagEditError("the list name must be kebab-case");
  if (!(name in d.lists)) throw new ModerationFlagEditError(`no such flag list: ${name} (lists: ${Object.keys(d.lists).join(", ") || "none"})`);
  const t = normTerm(term);
  if (!t) throw new ModerationFlagEditError("a non-empty term is required");
  if (t.length > MAX_TERM) throw new ModerationFlagEditError(`a term is capped at ${MAX_TERM} characters`);
  return { name, t };
}
function addFlagTerm(doc, { list, term } = {}, ctx = {}) {
  const d = clean4(doc);
  const { name, t } = requireListAndTerm(d, list, term);
  if (d.lists[name].some((x) => normTerm(x).toLowerCase() === t.toLowerCase())) {
    return { next: d, changed: false, audit: auditEntry5(ctx, "flag-term.add", name, { term: t, noop: true }) };
  }
  d.lists[name].push(t);
  d.lists[name].sort((a, b) => String(a).localeCompare(String(b)));
  return { next: d, changed: true, audit: auditEntry5(ctx, "flag-term.add", name, { term: t }) };
}
function removeFlagTerm(doc, { list, term } = {}, ctx = {}) {
  const d = clean4(doc);
  const { name, t } = requireListAndTerm(d, list, term);
  const i = d.lists[name].findIndex((x) => normTerm(x).toLowerCase() === t.toLowerCase());
  if (i < 0) throw new ModerationFlagEditError(`term not in ${name}: ${t}`);
  d.lists[name].splice(i, 1);
  return { next: d, changed: true, audit: auditEntry5(ctx, "flag-term.remove", name, { term: t }) };
}

// membership/syndication-config-core.mjs
var CHANNELS = Object.freeze(["discord", "discord-category", "x", "linkedin", "bluesky", "reddit", "devto", "hashnode", "dailydev"]);
var TEMPLATE_CHANNELS = CHANNELS;
var CHANNEL_CAPABILITY = Object.freeze({
  discord: "auto",
  "discord-category": "auto",
  reddit: "auto",
  devto: "auto",
  // SOW-134 built the full-body auto adapter, but Hashnode retired its free GraphQL API (2026-05-13): API
  // publishing now needs a paid Pro plan on the publication. Owner-decided: keep Hashnode as a MANUAL-assist
  // channel (a Social Queue task a superadmin posts by hand) instead of paying for Pro. The adapter is kept but
  // never called (manual channels are hard-excluded from the adapter run); flip back to 'auto' if Pro is added.
  hashnode: "manual",
  // SOW-134 + manual pivot: no Pro, so hand-post to gbti.hashnode.dev via the Social Queue
  mastodon: "auto",
  // SOW-123
  bluesky: "auto",
  // SOW-122
  x: "manual",
  // SOW-120: the adapter renders, but posting is manual-assist (the free API tier was deprecated)
  dailydev: "manual",
  // SOW-135: manual-assist to the GBTI daily.dev squad (no public squad-post API)
  linkedin: "manual"
  // SOW-127: manual-assist until Community Management API access is granted (business
  // verification failed; the appeal is pending). The text is rendered + queued to the Social Queue; a
  // superadmin posts it by hand through the free LinkedIn composer. No LinkedIn API token is used.
});
function channelCapability(name) {
  return CHANNEL_CAPABILITY[name] ?? "building";
}
var AUTO_TYPES = Object.freeze(["share", "post", "product", "prompt"]);
var AUTO_CHANNELS = Object.freeze(CHANNELS.filter((c) => CHANNEL_CAPABILITY[c] === "auto"));
var MATRIX_CHANNELS = Object.freeze(CHANNELS.filter((c) => channelCapability(c) !== "building"));
var AUTO_MODES = Object.freeze(["off", "on", "on-manual", "popular"]);
function defaultAutoMode(type) {
  return type === "share" ? "off" : "on";
}
var CLASSIFY_MODES = Object.freeze(["ai", "keyword", "off"]);
var NEWS_ENGAGEMENT_TIERS = Object.freeze(["paid", "paid-trial", "signed-in"]);
var DEFAULT_NEWS_ENGAGEMENT = Object.freeze({
  enabled: false,
  // fail-closed: nothing auto-posts until the owner flips it in house/syndication-config.yml
  open_threshold: 2,
  // distinct members opening the detail view before the item auto-posts
  tier: "paid",
  // whose engagement counts (owner-toggleable in the admin Channels tab)
  comment_autopost: true
  // one comment posts immediately (deliberate engagement)
});
var CONTENT_ENGAGEMENT_SIGNALS = Object.freeze(["opens", "favorites", "upvotes", "comments"]);
var DEFAULT_CONTENT_ENGAGEMENT = Object.freeze({
  enabled: false,
  threshold: 3,
  // distinct engaged members before a `popular` item promotes (tunable; the network is small)
  tier: "signed-in",
  // whose engagement counts (any non-banned signed-in member by default)
  signals: Object.freeze({ opens: true, favorites: false, upvotes: false, comments: false })
  // opens = the owner's chosen counter
});
var TEMPLATE_TYPES = Object.freeze(["share", "post", "product", "prompt", "reddit-body", "reddit-comment", "devto-intro", "devto-body", "devto-footer", "devto-stub", "hashnode-intro", "hashnode-body", "hashnode-footer", "hashnode-stub"]);
var DEFAULT_FORMAT = 'New {content-type} published by {member-discord-username}: "{title}" {url}';
var DEFAULT_SHARE_FORMAT = 'Shared on the GBTI Network: "{title}" {url}';
var DEFAULT_REDDIT_BODY = "{short-description}";
var DEFAULT_DEVTO_INTRO = "**By {member-devto-handle}, [GBTI Network Member]({member-url}).** Originally published on [gbti.network]({url}).";
var DEFAULT_HASHNODE_INTRO = "**By [{fullName}]({member-url}), GBTI Network Member.** Originally published on [gbti.network]({url}).";
var DEFAULT_DEVTO_BODY = "{body}";
var DEFAULT_DEVTO_FOOTER = "---\n\nAre you a writer, musician, or product developer? We would love to support your work on the GBTI Network. For more information about how to join our community visit https://gbti.network\n\nTo follow {fullName}'s work more closely, consider joining our network and subscribing to them directly: {member-url}";
var DEFAULT_REDDIT_COMMENT = "Shared to the community by GBTI Network member {member-reddit-handle}. {short-description}\n\n---\n\nAre you a writer, musician, or product developer? We would love to support your work on the GBTI Network. For more information about how to join our community visit https://gbti.network\n\nTo follow {fullName}'s work more closely, consider joining our network and subscribing to them directly: {member-url}";
var DEFAULT_TEMPLATES = Object.freeze({
  share: DEFAULT_SHARE_FORMAT,
  // sow-180: content-first, no member credit
  post: DEFAULT_FORMAT,
  product: DEFAULT_FORMAT,
  prompt: DEFAULT_FORMAT,
  "reddit-body": DEFAULT_REDDIT_BODY,
  "reddit-comment": DEFAULT_REDDIT_COMMENT,
  "devto-intro": DEFAULT_DEVTO_INTRO,
  "devto-body": DEFAULT_DEVTO_BODY,
  // SOW-138
  "devto-footer": DEFAULT_DEVTO_FOOTER,
  // SOW-134: Hashnode reuses the same CTA footer as dev.to (both are full-body crossposts with a canonical link
  // home); admins can diverge them per channel. SOW-140: the byline default is NAME-based here (not the dev.to
  // handle), since a member's dev.to profile is the wrong platform to mention on Hashnode.
  "hashnode-intro": DEFAULT_HASHNODE_INTRO,
  "hashnode-body": DEFAULT_DEVTO_BODY,
  // SOW-138
  "hashnode-footer": DEFAULT_DEVTO_FOOTER
});
var STUB_FORMAT = 'Members-only on the GBTI Network: "{title}" by {fullName}. {short-description} {url}';
var SHARE_STUB_FORMAT = 'A members-only link on the GBTI Network: "{title}". {short-description} Join to open it: {url}';
var DEFAULT_STUB_TEMPLATES = Object.freeze({
  share: SHARE_STUB_FORMAT,
  // sow-180: content-first, no member credit
  post: STUB_FORMAT,
  product: STUB_FORMAT,
  prompt: STUB_FORMAT,
  "reddit-body": "{short-description}\n\nThis {content-type} is part of the GBTI Network members library. Membership unlocks the full piece: {url}",
  "devto-stub": "{short-description}\n\n**[Read the full {content-type} on gbti.network]({url}).** Membership unlocks it, and members earn from the work they publish.",
  "hashnode-stub": "{short-description}\n\n**[Read the full {content-type} on gbti.network]({url}).** Membership unlocks it, and members earn from the work they publish."
  // SOW-134
});
var DISCORD_STUB = '{member-discord-username} published a members-only {content-type}: "{title}". Members can read it on gbti.network. {url}';
var DISCORD_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}" {url}';
var DISCORD_CAT_STUB = 'A members-only {content-type} landed in {category}: "{title}" by {member-discord-username}. {url}';
var DISCORD_CAT_SHARE_STUB = 'A members-only link in {category}: "{title}" {url}';
var REDDIT_TITLE_STUB = "{title} (a members-only {content-type} from the GBTI Network)";
var X_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it. {url}';
var X_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}". Join to open it. {url}';
var LINKEDIN_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Join the co-op to unlock it. {url}';
var LINKEDIN_SHARE_STUB = 'A members-only find on the GBTI Network: "{title}". Join the co-op to open it. {url}';
var BLUESKY_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it.';
var BLUESKY_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}". Join to open it.';
var MASTODON_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it. {url}';
var MASTODON_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}". Join to open it. {url}';
var DAILYDEV_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it. {url}';
var DAILYDEV_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}". Join to open it. {url}';
var DEFAULT_CHANNEL_STUB_TEMPLATES = Object.freeze({
  discord: Object.freeze({ share: DISCORD_SHARE_STUB, post: DISCORD_STUB, product: DISCORD_STUB, prompt: DISCORD_STUB }),
  "discord-category": Object.freeze({ share: DISCORD_CAT_SHARE_STUB, post: DISCORD_CAT_STUB, product: DISCORD_CAT_STUB, prompt: DISCORD_CAT_STUB }),
  reddit: Object.freeze({ share: REDDIT_TITLE_STUB, post: REDDIT_TITLE_STUB, product: REDDIT_TITLE_STUB, prompt: REDDIT_TITLE_STUB }),
  // dev.to titles are article titles: a clean suffix, never the sentence-shaped shared stub.
  devto: Object.freeze({ share: REDDIT_TITLE_STUB, post: REDDIT_TITLE_STUB, product: REDDIT_TITLE_STUB, prompt: REDDIT_TITLE_STUB }),
  // SOW-134: Hashnode titles are article titles too, so it mirrors dev.to's clean title suffix.
  // Hashnode is now a MANUAL-assist channel (the task text is a full message, not an article-title suffix), so
  // its members stub is sentence-shaped like the other manual channels.
  hashnode: Object.freeze({ share: DAILYDEV_SHARE_STUB, post: DAILYDEV_STUB, product: DAILYDEV_STUB, prompt: DAILYDEV_STUB }),
  x: Object.freeze({ share: X_SHARE_STUB, post: X_STUB, product: X_STUB, prompt: X_STUB }),
  linkedin: Object.freeze({ share: LINKEDIN_SHARE_STUB, post: LINKEDIN_STUB, product: LINKEDIN_STUB, prompt: LINKEDIN_STUB }),
  // SOW-127
  dailydev: Object.freeze({ share: DAILYDEV_SHARE_STUB, post: DAILYDEV_STUB, product: DAILYDEV_STUB, prompt: DAILYDEV_STUB }),
  // SOW-135
  bluesky: Object.freeze({ share: BLUESKY_SHARE_STUB, post: BLUESKY_STUB, product: BLUESKY_STUB, prompt: BLUESKY_STUB }),
  mastodon: Object.freeze({ share: MASTODON_SHARE_STUB, post: MASTODON_STUB, product: MASTODON_STUB, prompt: MASTODON_STUB })
});
var DEFAULT_SYNDICATION_CONFIG = Object.freeze({
  enabled: false,
  require_approval: true,
  // SOW-058: opt-IN by default — NOTHING posts until a superadmin approves it
  hold_minutes: 60,
  upvote_threshold: 2,
  classify: "ai",
  // SOW-087: the share category suggestion mode
  templates: DEFAULT_TEMPLATES,
  // SOW-087: per-type Discord templates (missing/empty type = its default)
  channel_templates: Object.freeze({}),
  // SOW-088: per-channel template OVERRIDES (channel -> type -> template)
  stub_templates: Object.freeze({}),
  // SOW-088 Proposal A: the shared MEMBERS-stub set (configured only)
  channel_templates_stub: Object.freeze({}),
  // SOW-088 Proposal A: per-channel stub overrides
  news_engagement: DEFAULT_NEWS_ENGAGEMENT,
  // SOW-111: engagement-triggered news auto-share
  content_engagement: DEFAULT_CONTENT_ENGAGEMENT,
  // SOW-126: engagement-triggered content auto-share (the `popular` engine)
  channels: Object.freeze({ discord: false, "discord-category": false, x: false, linkedin: false, mastodon: false, bluesky: false, reddit: false, devto: false, hashnode: false, dailydev: false }),
  // SOW-121: channels the system NEVER auto-posts to (their adapter is never called). Instead a
  // superadmin manual-assist task is enqueued (Social Queue) and a human posts it by hand. Used for
  // pay-to-post channels like X after the free API tier was deprecated. A channel here should be OFF in
  // `channels` (the two are mutually exclusive: auto-post vs manual-assist).
  manual_assist_channels: Object.freeze([]),
  // SOW-125: per-type-per-channel auto-share modes (off | on | popular). Layers on `channels` (a channel must
  // also be enabled + have its secret). The default (an absent matrix) is shares OFF, every other type ON.
  auto_matrix: buildDefaultAutoMatrix(),
  // SOW-125: per-channel delay override in minutes (absent -> the global hold_minutes). Lets one channel post
  // sooner/later than another for the same item.
  channel_hold_minutes: Object.freeze({})
});
function buildDefaultAutoMatrix() {
  const m = {};
  for (const t of AUTO_TYPES) {
    m[t] = {};
    for (const ch of MATRIX_CHANNELS) m[t][ch] = defaultAutoMode(t);
    Object.freeze(m[t]);
  }
  return Object.freeze(m);
}
function asBool(v, fallback) {
  if (v === true || v === false) return v;
  if (v === 1 || v === 0) return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "on" || s === "1") return true;
    if (s === "false" || s === "no" || s === "off" || s === "0") return false;
  }
  return fallback;
}
function asHoldMinutes(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}
function asThreshold(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i >= 1 ? i : fallback;
}
function asClassifyMode(v, fallback) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return CLASSIFY_MODES.includes(s) ? s : fallback;
}
function normalizeNewsEngagement(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = DEFAULT_NEWS_ENGAGEMENT;
  const tier = typeof src.tier === "string" && NEWS_ENGAGEMENT_TIERS.includes(src.tier.trim().toLowerCase()) ? src.tier.trim().toLowerCase() : d.tier;
  return Object.freeze({
    enabled: asBool(src.enabled, d.enabled),
    open_threshold: asThreshold(src.open_threshold, d.open_threshold),
    tier,
    comment_autopost: asBool(src.comment_autopost, d.comment_autopost)
  });
}
function normalizeContentEngagement(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = DEFAULT_CONTENT_ENGAGEMENT;
  const tier = typeof src.tier === "string" && NEWS_ENGAGEMENT_TIERS.includes(src.tier.trim().toLowerCase()) ? src.tier.trim().toLowerCase() : d.tier;
  const rawSignals = src.signals && typeof src.signals === "object" && !Array.isArray(src.signals) ? src.signals : {};
  const signals = {};
  for (const s of CONTENT_ENGAGEMENT_SIGNALS) signals[s] = asBool(rawSignals[s], d.signals[s]);
  return Object.freeze({
    enabled: asBool(src.enabled, d.enabled),
    threshold: asThreshold(src.threshold, d.threshold),
    tier,
    signals: Object.freeze(signals)
  });
}
function normalizeTemplates(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    const v = typeof src[t] === "string" ? src[t].trim() : "";
    const d = DEFAULT_TEMPLATES[t];
    if (v) out[t] = v;
    else if (d) out[t] = d;
  }
  return Object.freeze(out);
}
function normalizeChannelTemplates(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const ch of TEMPLATE_CHANNELS) {
    const block = src[ch];
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const kept = {};
    for (const t of TEMPLATE_TYPES) {
      const v = typeof block[t] === "string" ? block[t].trim() : "";
      if (v) kept[t] = v;
    }
    if (Object.keys(kept).length) out[ch] = Object.freeze(kept);
  }
  return Object.freeze(out);
}
function normalizeConfiguredTemplates(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    const v = typeof src[t] === "string" ? src[t].trim() : "";
    if (v) out[t] = v;
  }
  return Object.freeze(out);
}
function normalizeChannels(raw) {
  const out = {};
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const name of CHANNELS) out[name] = asBool(src[name], DEFAULT_SYNDICATION_CONFIG.channels[name]);
  return Object.freeze(out);
}
function normalizeManualAssist(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const v of list) {
    const s = String(v ?? "").trim();
    if (CHANNELS.includes(s) && !out.includes(s)) out.push(s);
  }
  return Object.freeze(out);
}
function asAutoMode(v, fallback) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return AUTO_MODES.includes(s) ? s : fallback;
}
function normalizeAutoMatrix(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const t of AUTO_TYPES) {
    const row = src[t] && typeof src[t] === "object" && !Array.isArray(src[t]) ? src[t] : {};
    out[t] = {};
    for (const ch of MATRIX_CHANNELS) {
      let m = asAutoMode(row[ch], defaultAutoMode(t));
      if (m === "on" && channelCapability(ch) === "manual") m = "on-manual";
      out[t][ch] = m;
    }
    Object.freeze(out[t]);
  }
  return Object.freeze(out);
}
function normalizeChannelHoldMinutes(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const ch of CHANNELS) {
    if (src[ch] === void 0 || src[ch] === null || src[ch] === "") continue;
    const n = Number(src[ch]);
    if (Number.isFinite(n)) out[ch] = Math.max(0, Math.floor(n));
  }
  return Object.freeze(out);
}
function syndicationConfigFromParsed(parsed) {
  const raw = parsed?.syndication ?? parsed ?? {};
  const d = DEFAULT_SYNDICATION_CONFIG;
  return Object.freeze({
    enabled: asBool(raw.enabled, d.enabled),
    require_approval: asBool(raw.require_approval, d.require_approval),
    hold_minutes: asHoldMinutes(raw.hold_minutes, d.hold_minutes),
    upvote_threshold: asThreshold(raw.upvote_threshold, d.upvote_threshold),
    classify: asClassifyMode(raw.classify, d.classify),
    templates: normalizeTemplates(raw.templates),
    channel_templates: normalizeChannelTemplates(raw.channel_templates),
    stub_templates: normalizeConfiguredTemplates(raw.stub_templates),
    channel_templates_stub: normalizeChannelTemplates(raw.channel_templates_stub),
    news_engagement: normalizeNewsEngagement(raw.news_engagement),
    content_engagement: normalizeContentEngagement(raw.content_engagement),
    // SOW-126
    channels: normalizeChannels(raw.channels),
    manual_assist_channels: normalizeManualAssist(raw.manual_assist_channels),
    // SOW-121
    auto_matrix: normalizeAutoMatrix(raw.auto_matrix),
    // SOW-125
    channel_hold_minutes: normalizeChannelHoldMinutes(raw.channel_hold_minutes)
    // SOW-125
  });
}
function newsEngagement(cfg) {
  return normalizeNewsEngagement(cfg?.news_engagement);
}
function contentEngagement(cfg) {
  return normalizeContentEngagement(cfg?.content_engagement);
}

// membership/syndication-template-edits.mjs
var TemplateEditError = class extends Error {
};
var MAX_TEMPLATE = 500;
var MAX_BODY_TEMPLATE = 4e3;
var BODY_TYPES = /* @__PURE__ */ new Set(["devto-body", "hashnode-body"]);
function isoOf7(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new TemplateEditError("invalid timestamp");
  return d.toISOString();
}
function auditEntry6(ctx, type, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf7(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : a.github_id != null ? String(a.github_id) : null, login: a.login ?? null } : null,
    action: "syndication-template.set",
    target: { type },
    detail: detail ?? null
  };
}
function setNewsEngagement(doc, { enabled, openThreshold, tier, commentAutopost } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === "object" ? doc : {});
  if (!d.syndication || typeof d.syndication !== "object" || Array.isArray(d.syndication)) d.syndication = {};
  const cur = newsEngagement({ news_engagement: d.syndication.news_engagement });
  const next = { ...cur };
  if (enabled !== void 0) {
    if (typeof enabled !== "boolean") throw new TemplateEditError("enabled must be true or false");
    next.enabled = enabled;
  }
  if (openThreshold !== void 0) {
    const n = Number(openThreshold);
    if (!Number.isInteger(n) || n < 1 || n > 1e3) throw new TemplateEditError("openThreshold must be an integer from 1 to 1000");
    next.open_threshold = n;
  }
  if (tier !== void 0) {
    const t = String(tier || "").trim().toLowerCase();
    if (!NEWS_ENGAGEMENT_TIERS.includes(t)) throw new TemplateEditError(`tier must be one of: ${NEWS_ENGAGEMENT_TIERS.join(", ")}`);
    next.tier = t;
  }
  if (commentAutopost !== void 0) {
    if (typeof commentAutopost !== "boolean") throw new TemplateEditError("commentAutopost must be true or false");
    next.comment_autopost = commentAutopost;
  }
  const audit2 = (detail) => {
    const a = ctx?.actor || null;
    return {
      at: isoOf7(ctx?.now),
      actor: a ? { github_id: a.githubId != null ? String(a.githubId) : a.github_id != null ? String(a.github_id) : null, login: a.login ?? null } : null,
      action: "news-engagement.set",
      target: { file: "house/syndication-config.yml" },
      detail
    };
  };
  const same = next.enabled === cur.enabled && next.open_threshold === cur.open_threshold && next.tier === cur.tier && next.comment_autopost === cur.comment_autopost;
  if (same) return { next: d, changed: false, audit: audit2({ ...next, noop: true }) };
  d.syndication.news_engagement = {
    enabled: next.enabled,
    open_threshold: next.open_threshold,
    tier: next.tier,
    comment_autopost: next.comment_autopost
  };
  return { next: d, changed: true, audit: audit2({ ...next }) };
}
function setContentEngagement(doc, { enabled, threshold, tier, signals } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === "object" ? doc : {});
  if (!d.syndication || typeof d.syndication !== "object" || Array.isArray(d.syndication)) d.syndication = {};
  const cur = contentEngagement({ content_engagement: d.syndication.content_engagement });
  const next = { ...cur, signals: { ...cur.signals } };
  if (enabled !== void 0) {
    if (typeof enabled !== "boolean") throw new TemplateEditError("enabled must be true or false");
    next.enabled = enabled;
  }
  if (threshold !== void 0) {
    const n = Number(threshold);
    if (!Number.isInteger(n) || n < 1 || n > 1e3) throw new TemplateEditError("threshold must be an integer from 1 to 1000");
    next.threshold = n;
  }
  if (tier !== void 0) {
    const t = String(tier || "").trim().toLowerCase();
    if (!NEWS_ENGAGEMENT_TIERS.includes(t)) throw new TemplateEditError(`tier must be one of: ${NEWS_ENGAGEMENT_TIERS.join(", ")}`);
    next.tier = t;
  }
  if (signals !== void 0) {
    if (!signals || typeof signals !== "object" || Array.isArray(signals)) throw new TemplateEditError("signals must be an object of { signal: boolean }");
    for (const [name, on] of Object.entries(signals)) {
      if (!CONTENT_ENGAGEMENT_SIGNALS.includes(name)) throw new TemplateEditError(`unknown signal "${name}"`);
      if (typeof on !== "boolean") throw new TemplateEditError(`signal "${name}" must be true or false`);
      next.signals[name] = on;
    }
  }
  const audit2 = (detail) => {
    const a = ctx?.actor || null;
    return {
      at: isoOf7(ctx?.now),
      actor: a ? { github_id: a.githubId != null ? String(a.githubId) : a.github_id != null ? String(a.github_id) : null, login: a.login ?? null } : null,
      action: "content-engagement.set",
      target: { file: "house/syndication-config.yml" },
      detail
    };
  };
  const sameSignals = CONTENT_ENGAGEMENT_SIGNALS.every((s) => next.signals[s] === cur.signals[s]);
  const same = next.enabled === cur.enabled && next.threshold === cur.threshold && next.tier === cur.tier && sameSignals;
  if (same) return { next: d, changed: false, audit: audit2({ ...next, noop: true }) };
  d.syndication.content_engagement = {
    enabled: next.enabled,
    threshold: next.threshold,
    tier: next.tier,
    signals: { ...next.signals }
  };
  return { next: d, changed: true, audit: audit2({ ...next }) };
}
function setTemplate(doc, { type, template, channel, stub } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === "object" ? doc : {});
  if (!d.syndication || typeof d.syndication !== "object" || Array.isArray(d.syndication)) d.syndication = {};
  const t = String(type || "").trim();
  if (!TEMPLATE_TYPES.includes(t)) throw new TemplateEditError(`the type must be one of: ${TEMPLATE_TYPES.join(", ")}`);
  const value = String(template ?? "").trim();
  const cap = BODY_TYPES.has(t) ? MAX_BODY_TEMPLATE : MAX_TEMPLATE;
  if (value.length > cap) throw new TemplateEditError(`a template is capped at ${cap} characters`);
  const isStub = stub === true;
  const chField = isStub ? "channel_templates_stub" : "channel_templates";
  const sharedField = isStub ? "stub_templates" : "templates";
  const ch = String(channel || "").trim();
  if (ch) {
    if (!SYNDICATION_CHANNEL_NAMES.includes(ch)) throw new TemplateEditError(`unknown channel "${ch}"`);
    const all = d.syndication[chField] && typeof d.syndication[chField] === "object" && !Array.isArray(d.syndication[chField]) ? d.syndication[chField] : {};
    const curCh = all[ch] && typeof all[ch] === "object" && !Array.isArray(all[ch]) ? all[ch] : {};
    const existing2 = typeof curCh[t] === "string" ? curCh[t].trim() : "";
    if (existing2 === value) return { next: d, changed: false, audit: auditEntry6(ctx, t, { channel: ch, stub: isStub || void 0, template: value || null, noop: true }) };
    const nextCh = { ...curCh };
    if (value) nextCh[t] = value;
    else delete nextCh[t];
    const nextAll = { ...all };
    if (Object.keys(nextCh).length) nextAll[ch] = nextCh;
    else delete nextAll[ch];
    if (Object.keys(nextAll).length) d.syndication[chField] = nextAll;
    else delete d.syndication[chField];
    return { next: d, changed: true, audit: auditEntry6(ctx, t, { channel: ch, stub: isStub || void 0, template: value || null }) };
  }
  const cur = d.syndication[sharedField] && typeof d.syndication[sharedField] === "object" && !Array.isArray(d.syndication[sharedField]) ? d.syndication[sharedField] : {};
  const existing = typeof cur[t] === "string" ? cur[t].trim() : "";
  if (existing === value) return { next: d, changed: false, audit: auditEntry6(ctx, t, { stub: isStub || void 0, template: value || null, noop: true }) };
  const nextTemplates = { ...cur };
  if (value) nextTemplates[t] = value;
  else delete nextTemplates[t];
  d.syndication[sharedField] = nextTemplates;
  return { next: d, changed: true, audit: auditEntry6(ctx, t, { stub: isStub || void 0, template: value || null }) };
}
var SYNDICATION_CHANNEL_NAMES = Object.freeze(["discord", "discord-category", "x", "linkedin", "bluesky", "reddit", "devto", "hashnode", "dailydev"]);
function setSyndicationSettings(doc, { enabled, requireApproval, holdMinutes, channels, autoMatrix, channelHoldMinutes } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === "object" ? doc : {});
  if (!d.syndication || typeof d.syndication !== "object" || Array.isArray(d.syndication)) d.syndication = {};
  const cur = syndicationConfigFromParsed(doc);
  let changed = false;
  const detail = {};
  if (enabled !== void 0) {
    if (typeof enabled !== "boolean") throw new TemplateEditError("enabled must be a boolean");
    if (enabled !== cur.enabled) {
      d.syndication.enabled = enabled;
      changed = true;
      detail.enabled = enabled;
    }
  }
  if (requireApproval !== void 0) {
    if (typeof requireApproval !== "boolean") throw new TemplateEditError("requireApproval must be a boolean");
    if (requireApproval !== cur.require_approval) {
      d.syndication.require_approval = requireApproval;
      changed = true;
      detail.require_approval = requireApproval;
    }
  }
  if (holdMinutes !== void 0) {
    const h = Number(holdMinutes);
    if (!Number.isInteger(h) || h < 0 || h > 1440) throw new TemplateEditError("holdMinutes must be an integer between 0 and 1440");
    if (h !== cur.hold_minutes) {
      d.syndication.hold_minutes = h;
      changed = true;
      detail.hold_minutes = h;
    }
  }
  if (channels !== void 0) {
    if (!channels || typeof channels !== "object" || Array.isArray(channels)) throw new TemplateEditError("channels must be an object of { name: boolean }");
    for (const [name, on] of Object.entries(channels)) {
      if (!SYNDICATION_CHANNEL_NAMES.includes(name)) throw new TemplateEditError(`unknown channel "${name}"`);
      if (typeof on !== "boolean") throw new TemplateEditError(`channel "${name}" must be a boolean`);
      if (Boolean(cur.channels?.[name]) !== on) {
        if (!d.syndication.channels || typeof d.syndication.channels !== "object") d.syndication.channels = {};
        d.syndication.channels[name] = on;
        changed = true;
        (detail.channels ??= {})[name] = on;
      }
    }
  }
  if (autoMatrix !== void 0) {
    if (!autoMatrix || typeof autoMatrix !== "object" || Array.isArray(autoMatrix)) throw new TemplateEditError("autoMatrix must be an object of { type: { channel: mode } }");
    for (const [type, row] of Object.entries(autoMatrix)) {
      if (!AUTO_TYPES.includes(type)) throw new TemplateEditError(`unknown auto-share type "${type}"`);
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new TemplateEditError(`autoMatrix.${type} must be an object of { channel: mode }`);
      for (const [ch, mode] of Object.entries(row)) {
        if (!MATRIX_CHANNELS.includes(ch)) throw new TemplateEditError(`"${ch}" is not an auto-share channel`);
        if (!AUTO_MODES.includes(mode)) throw new TemplateEditError(`auto-share mode for ${type}/${ch} must be one of ${AUTO_MODES.join(", ")}`);
        if (mode === "on" && channelCapability(ch) === "manual") {
          throw new TemplateEditError(`${ch} cannot post automatically; use on-manual (the Social Queue)`);
        }
        if ((cur.auto_matrix?.[type]?.[ch] ?? "off") !== mode) {
          if (!d.syndication.auto_matrix || typeof d.syndication.auto_matrix !== "object") d.syndication.auto_matrix = {};
          if (!d.syndication.auto_matrix[type] || typeof d.syndication.auto_matrix[type] !== "object") d.syndication.auto_matrix[type] = {};
          d.syndication.auto_matrix[type][ch] = mode;
          changed = true;
          ((detail.auto_matrix ??= {})[type] ??= {})[ch] = mode;
        }
      }
    }
  }
  if (channelHoldMinutes !== void 0) {
    if (!channelHoldMinutes || typeof channelHoldMinutes !== "object" || Array.isArray(channelHoldMinutes)) throw new TemplateEditError("channelHoldMinutes must be an object of { channel: minutes }");
    for (const [name, mins] of Object.entries(channelHoldMinutes)) {
      if (!SYNDICATION_CHANNEL_NAMES.includes(name)) throw new TemplateEditError(`unknown channel "${name}"`);
      const clear = mins === "" || mins === null;
      let h = null;
      if (!clear) {
        h = Number(mins);
        if (!Number.isInteger(h) || h < 0 || h > 1440) throw new TemplateEditError(`channelHoldMinutes.${name} must be an integer between 0 and 1440`);
      }
      const curVal = cur.channel_hold_minutes?.[name];
      if (clear ? curVal !== void 0 : curVal !== h) {
        if (!d.syndication.channel_hold_minutes || typeof d.syndication.channel_hold_minutes !== "object") d.syndication.channel_hold_minutes = {};
        if (clear) delete d.syndication.channel_hold_minutes[name];
        else d.syndication.channel_hold_minutes[name] = h;
        changed = true;
        (detail.channel_hold_minutes ??= {})[name] = clear ? null : h;
      }
    }
  }
  if (!changed) return { next: doc, changed: false, audit: null };
  return { next: d, changed: true, audit: { ...auditEntry6(ctx, "settings", detail), action: "syndication-settings.set" } };
}

// client/src/admin-ops.mjs
async function adminPublish(ctx, opts) {
  await syncForkIfCreatingBranch(ctx, opts.repo, opts.branch);
  return publishFiles(opts);
}
function requireRole(ctx, check2, need) {
  const role = ctx.role?.() ?? "member";
  if (!check2(role)) throw new OperationError("forbidden", `requires ${need} (you are ${role})`);
  return role;
}
function requireRepo2(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError("not-authenticated", "run `gbti login` first");
  if (!ctx.store?.get("repoPath")) throw new OperationError("bad-request", "no local repoPath configured");
  return { repo };
}
var readYaml = async (ctx, rel) => {
  try {
    return index_vite_proxy_tmp_default.load(await ctx.reader?.readFile?.(rel) || "") ?? {};
  } catch {
    return {};
  }
};
var dumpYaml = (obj) => index_vite_proxy_tmp_default.dump(obj, { lineWidth: 100, noRefs: true });
var slugOf = (rel) => rel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48);
function actionCtx(ctx) {
  const id = ctx.identity?.();
  return {
    actor: id ? { githubId: id.githubId ?? id.github_id ?? null, login: id.login ?? null } : null,
    now: ctx.now ? ctx.now() : void 0
  };
}
function prBody(reason, auditEntry7) {
  const head = reason ? `Reason: ${reason}

` : "";
  return `${head}<!-- gbti-audit ${JSON.stringify(auditEntry7)} -->`;
}
var noop = (message, auditEntry7) => ({ changed: false, noop: true, message, audit: auditEntry7 });
function requireId(githubId) {
  if (githubId === void 0 || githubId === null || String(githubId).trim() === "") {
    throw new OperationError("bad-request", "githubId is required");
  }
  return String(githubId);
}
function requirePath(rel) {
  if (!rel || typeof rel !== "string" || rel.includes("\\") || rel.startsWith("/")) {
    throw new OperationError("bad-request", "a valid in-repo content path is required");
  }
  const segments = rel.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new OperationError("bad-request", "a valid in-repo content path is required");
  }
  return rel;
}
function requireMemberContentPath(rel) {
  requirePath(rel);
  if (!rel.startsWith("members/")) {
    throw new OperationError("forbidden", "moderation is limited to member content (members/<user>/...)");
  }
  return rel;
}
async function banMember(ctx, { githubId, reason } = {}) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const id = requireId(githubId);
  const { next, changed, audit: audit2 } = ban(await readYaml(ctx, "house/bans.yml"), { githubId: id, reason }, actionCtx(ctx));
  if (!changed) return noop(`already banned: ${id}`, audit2);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/ban-${id}`, files: [{ path: "house/bans.yml", content: dumpYaml(next) }], message: `Ban ${id}`, title: `Ban member ${id}`, body: prBody(reason, audit2) });
  return { ...pr, changed: true, audit: audit2 };
}
async function unbanMember(ctx, { githubId } = {}) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const id = requireId(githubId);
  const { next, changed, audit: audit2 } = unban(await readYaml(ctx, "house/bans.yml"), { githubId: id }, actionCtx(ctx));
  if (!changed) return noop(`not banned: ${id}`, audit2);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/unban-${id}`, files: [{ path: "house/bans.yml", content: dumpYaml(next) }], message: `Unban ${id}`, title: `Unban member ${id}`, body: prBody(null, audit2) });
  return { ...pr, changed: true, audit: audit2 };
}
async function grandfatherMember(ctx, { githubId, reason, until = null, login } = {}) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const id = requireId(githubId);
  let result;
  try {
    result = grandfather(await readYaml(ctx, "house/grandfathered.yml"), { githubId: id, login, reason, until }, actionCtx(ctx));
  } catch (err) {
    if (err instanceof SuperadminActionError) throw new OperationError("bad-request", err.message);
    throw err;
  }
  if (!result.changed) return noop(`already grandfathered: ${id}`, result.audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/grandfather-${id}`, files: [{ path: "house/grandfathered.yml", content: dumpYaml(result.next) }], message: `Grandfather ${id}`, title: `Grandfather member ${id}`, body: prBody(reason, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}
async function ungrandfatherMember(ctx, { githubId } = {}) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const id = requireId(githubId);
  const { next, changed, audit: audit2 } = revokeGrandfather(await readYaml(ctx, "house/grandfathered.yml"), { githubId: id }, actionCtx(ctx));
  if (!changed) return noop(`not grandfathered: ${id}`, audit2);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/ungrandfather-${id}`, files: [{ path: "house/grandfathered.yml", content: dumpYaml(next) }], message: `Remove grandfather ${id}`, title: `Remove grandfather for ${id}`, body: prBody(null, audit2) });
  return { ...pr, changed: true, audit: audit2 };
}
async function setMemberRole(ctx, { githubId, role, login } = {}) {
  requireRole(ctx, canManageRoles, "superadmin");
  const { repo } = requireRepo2(ctx);
  const id = requireId(githubId);
  if (!role) throw new OperationError("bad-request", "role is required (member|moderator|admin|superadmin)");
  let result;
  try {
    result = grantRole(await readYaml(ctx, "house/roles.yml"), { githubId: id, role, login }, actionCtx(ctx));
  } catch (err) {
    if (err instanceof SuperadminActionError) throw new OperationError("bad-request", err.message);
    throw err;
  }
  if (!result.changed) return noop(`already ${role}: ${id}`, result.audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/role-${id}`, files: [{ path: "house/roles.yml", content: dumpYaml(result.next) }], message: `Set ${id} role=${role}`, title: `Set role for ${id}: ${role}`, body: prBody(`role: ${role}`, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}
async function deplatformContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canModerate, "moderator");
  const { repo } = requireRepo2(ctx);
  requireMemberContentPath(rel);
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError("not-found", `no such file: ${rel}`);
  const flip = flipContentStatus(text, "draft");
  const content = flip.changed ? flip.content : text;
  return adminPublish(ctx, { repo, branch: `gbti/deplatform-${slugOf(rel)}`, files: [{ path: rel, content }], message: `Deplatform ${rel}`, title: `Deplatform ${rel}`, body: "Moderation: set status to draft." });
}
async function republishContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canModerate, "moderator");
  const { repo } = requireRepo2(ctx);
  requireMemberContentPath(rel);
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError("not-found", `no such file: ${rel}`);
  const flip = flipContentStatus(text, "published");
  const content = flip.changed ? flip.content : text;
  return adminPublish(ctx, { repo, branch: `gbti/republish-${slugOf(rel)}`, files: [{ path: rel, content }], message: `Republish ${rel}`, title: `Republish ${rel}`, body: "Moderation: set status to published." });
}
async function removeContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  requireMemberContentPath(rel);
  return adminPublish(ctx, { repo, branch: `gbti/remove-${slugOf(rel)}`, files: [{ path: rel, content: null }], message: `Remove ${rel}`, title: `Remove ${rel}`, body: "Moderation: remove content." });
}
var TAXONOMY_PATH = "house/taxonomy.yml";
function leadingComment(raw) {
  const out = [];
  for (const line of String(raw || "").split("\n")) {
    if (/^\s*#/.test(line) || line.trim() === "") out.push(line);
    else break;
  }
  const block = out.join("\n").replace(/\s+$/, "");
  return block ? `${block}
` : "";
}
async function getTaxonomy(ctx) {
  const raw = await ctx.reader?.readFile?.(TAXONOMY_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  return { tree: parsed.tree || {} };
}
async function addContentCategory(ctx, { parentPath, key, label } = {}) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const raw = await ctx.reader?.readFile?.(TAXONOMY_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  let result;
  try {
    result = addCategory(parsed, { parentPath, key, label }, actionCtx(ctx));
  } catch (err) {
    if (err instanceof TaxonomyEditError) throw new OperationError("bad-request", err.message);
    throw err;
  }
  const fullPath = [...Array.isArray(parentPath) ? parentPath : [], key].filter(Boolean);
  if (!result.changed) return noop(`category already exists: ${fullPath.join(" > ")}`, result.audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/category-add-${slugOf(fullPath.join("-"))}`, files: [{ path: TAXONOMY_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message: `Add category ${fullPath.join("/")}`, title: `Add category: ${label}`, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}
async function renameContentCategoryLabel(ctx, { path, label } = {}) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const raw = await ctx.reader?.readFile?.(TAXONOMY_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  let result;
  try {
    result = renameLabel(parsed, { path, label }, actionCtx(ctx));
  } catch (err) {
    if (err instanceof TaxonomyEditError) throw new OperationError("bad-request", err.message);
    throw err;
  }
  const p = Array.isArray(path) ? path : [];
  if (!result.changed) return noop(`label unchanged: ${p.join(" > ")}`, result.audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/category-rename-${slugOf(p.join("-"))}`, files: [{ path: TAXONOMY_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message: `Rename category ${p.join("/")} -> ${label}`, title: `Rename category: ${label}`, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}
var NEWS_SOURCES_PATH = "house/news-sources.yml";
async function getNewsSourcePool(ctx) {
  const raw = await ctx.reader?.readFile?.(NEWS_SOURCES_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  return { sources: Array.isArray(parsed.sources) ? parsed.sources : [] };
}
async function editNewsSources(ctx, edit, { branch, message, title, noopMsg }) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const raw = await ctx.reader?.readFile?.(NEWS_SOURCES_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  let result;
  try {
    result = edit(parsed);
  } catch (err) {
    if (err instanceof NewsSourceEditError) throw new OperationError("bad-request", err.message);
    throw err;
  }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await adminPublish(ctx, { repo, branch, files: [{ path: NEWS_SOURCES_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}
async function addNewsSource(ctx, { id, name, url: url2, description } = {}) {
  const sid = slugOf(String(id || name || ""));
  return editNewsSources(
    ctx,
    (parsed) => addSource(parsed, { id, name, url: url2, description }, actionCtx(ctx)),
    { branch: `gbti/news-source-add-${sid}`, message: `Add news source ${id || name}`, title: `Add news source: ${name || id}`, noopMsg: `news source already present: ${id || name}` }
  );
}
async function removeNewsSource(ctx, { id } = {}) {
  const sid = slugOf(String(id || ""));
  return editNewsSources(
    ctx,
    (parsed) => removeSource(parsed, { id }, actionCtx(ctx)),
    { branch: `gbti/news-source-remove-${sid}`, message: `Remove news source ${id}`, title: `Remove news source: ${id}`, noopMsg: `no such news source: ${id}` }
  );
}
async function setNewsSourceEnabled(ctx, { id, enabled } = {}) {
  const sid = slugOf(String(id || ""));
  const on = !!enabled;
  return editNewsSources(
    ctx,
    (parsed) => setSourceEnabled(parsed, { id, enabled: on }, actionCtx(ctx)),
    { branch: `gbti/news-source-${on ? "enable" : "disable"}-${sid}`, message: `${on ? "Enable" : "Disable"} news source ${id}`, title: `${on ? "Enable" : "Disable"} news source: ${id}`, noopMsg: `news source already ${on ? "enabled" : "disabled"}: ${id}` }
  );
}
var COUPONS_PATH = "house/coupons.yml";
async function getCouponPool(ctx) {
  const raw = await ctx.reader?.readFile?.(COUPONS_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  return { coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [] };
}
var QUOTES_PATH = "house/quotes.yml";
var quoteSlug = (text) => slugOf(String(text || "").slice(0, 40)) || "quote";
async function getQuotePool(ctx) {
  const raw = await ctx.reader?.readFile?.(QUOTES_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  return { quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [] };
}
async function editQuotes(ctx, edit, { branch, message, title, noopMsg }) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const raw = await ctx.reader?.readFile?.(QUOTES_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  let result;
  try {
    result = edit(parsed);
  } catch (err) {
    if (err instanceof QuoteEditError) throw new OperationError("bad-request", err.message);
    throw err;
  }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await adminPublish(ctx, { repo, branch, files: [{ path: QUOTES_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}
async function addQuote2(ctx, { text, author } = {}) {
  return editQuotes(
    ctx,
    (parsed) => addQuote(parsed, { text, author }, actionCtx(ctx)),
    { branch: `gbti/quote-add-${quoteSlug(text)}`, message: `Add quote (${author || "unknown"})`, title: `Add quote: ${author || "unknown"}`, noopMsg: "quote already present" }
  );
}
async function removeQuote2(ctx, { text } = {}) {
  return editQuotes(
    ctx,
    (parsed) => removeQuote(parsed, { text }, actionCtx(ctx)),
    { branch: `gbti/quote-remove-${quoteSlug(text)}`, message: "Remove quote", title: "Remove quote", noopMsg: "no such quote" }
  );
}
async function setQuoteEnabled2(ctx, { text, enabled } = {}) {
  const on = !!enabled;
  return editQuotes(
    ctx,
    (parsed) => setQuoteEnabled(parsed, { text, enabled: on }, actionCtx(ctx)),
    { branch: `gbti/quote-${on ? "enable" : "disable"}-${quoteSlug(text)}`, message: `${on ? "Enable" : "Disable"} quote`, title: `${on ? "Enable" : "Disable"} quote`, noopMsg: `quote already ${on ? "enabled" : "disabled"}` }
  );
}
var CONTENT_CHANNELS_PATH = "house/content-channels.yml";
var MODERATION_FLAGS_PATH = "house/moderation-flags.yml";
var SYNDICATION_CONFIG_PATH = "house/syndication-config.yml";
async function getContentChannelPool(ctx) {
  const parsed = await readYaml(ctx, CONTENT_CHANNELS_PATH);
  return { channels: Array.isArray(parsed.channels) ? parsed.channels : [] };
}
async function getModerationFlagPool(ctx) {
  const parsed = await readYaml(ctx, MODERATION_FLAGS_PATH);
  const lists = parsed.lists && typeof parsed.lists === "object" && !Array.isArray(parsed.lists) ? parsed.lists : {};
  return { lists };
}
async function getSyndicationTemplatePool(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  const cfg = syndicationConfigFromParsed(parsed);
  return { templates: cfg.templates, channelTemplates: cfg.channel_templates, stubTemplates: cfg.stub_templates, channelTemplatesStub: cfg.channel_templates_stub, types: [...TEMPLATE_TYPES], channels: [...TEMPLATE_CHANNELS] };
}
async function editHouseYaml(ctx, relPath, edit, { branch, message, title, noopMsg, errType }) {
  requireRole(ctx, canManageRoles, "superadmin");
  const { repo } = requireRepo2(ctx);
  const raw = await ctx.reader?.readFile?.(relPath) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  let result;
  try {
    result = edit(parsed);
  } catch (err) {
    if (err instanceof errType) throw new OperationError("bad-request", err.message);
    throw err;
  }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await adminPublish(ctx, { repo, branch, files: [{ path: relPath, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit), clobberOpenPull: true });
  return { ...pr, changed: true, audit: result.audit };
}
async function applyTagEdit(ctx, { mode, action, tag, to, paths } = {}) {
  requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const act = String(mode || action || "");
  if (!["rename", "merge", "retire"].includes(act)) throw new OperationError("bad-request", "mode must be rename, merge, or retire");
  const src = String(tag || "").trim().toLowerCase();
  if (!src) throw new OperationError("bad-request", "a tag is required");
  const dest = act === "retire" ? null : String(to || "").trim().toLowerCase();
  if (act !== "retire" && !dest) throw new OperationError("bad-request", `${act} needs a destination tag`);
  if (dest === src) throw new OperationError("bad-request", "the destination equals the source");
  const list = (Array.isArray(paths) ? paths : []).filter((p) => /^(members\/[a-z0-9][a-z0-9-]*|house)\/(posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/.test(String(p)));
  if (!list.length || list.length > 100) throw new OperationError("bad-request", "between 1 and 100 content paths are required");
  const files = [];
  for (const rel of list) {
    const text = await ctx.reader?.readFile?.(rel);
    if (text == null) continue;
    const r = retagContent(text, { tag: src, to: dest });
    if (r.changed) files.push({ path: rel, content: r.content });
  }
  if (!files.length) return noop(`no item carries the tag "${src}"`);
  const verb = act === "retire" ? `Retire tag ${src}` : `${act === "merge" ? "Merge" : "Rename"} tag ${src} -> ${dest}`;
  const pr = await adminPublish(ctx, { repo, branch: `gbti/tag-${act}-${slugOf(src)}`, files, message: verb, title: verb, body: `Tag curation (SOW-100): ${verb} across ${files.length} item${files.length === 1 ? "" : "s"}.` });
  return { ...pr, changed: true, rewritten: files.length };
}
async function applyCategoryBatch(ctx, { ops, descriptions } = {}) {
  const list = Array.isArray(ops) ? ops : [];
  if (!list.length) throw new OperationError("bad-request", "the batch is empty");
  const kinds = new Set(list.map((o) => o?.kind));
  for (const k of kinds) {
    if (!["label", "add", "channel-set", "channel-remove"].includes(k)) {
      throw new OperationError("bad-request", `op kind "${k}" cannot batch (migrations are review-gated dispatches)`);
    }
  }
  const hasChannel = list.some((o) => o.kind === "channel-set" || o.kind === "channel-remove");
  if (hasChannel) requireRole(ctx, canManageRoles, "superadmin");
  else requireRole(ctx, canBanGrandfather, "admin");
  const { repo } = requireRepo2(ctx);
  const files = [];
  const applied = [];
  const applyFile = async (relPath, opsForFile, applyOne, errType) => {
    if (!opsForFile.length) return;
    const raw = await ctx.reader?.readFile?.(relPath) || "";
    let parsed;
    try {
      parsed = index_vite_proxy_tmp_default.load(raw) || {};
    } catch {
      parsed = {};
    }
    let changed = false;
    for (const op of opsForFile) {
      let result;
      try {
        result = applyOne(parsed, op);
      } catch (err) {
        if (err instanceof errType) throw new OperationError("bad-request", `${op.kind} ${JSON.stringify(op.args)}: ${err.message}`);
        throw err;
      }
      if (result.changed) {
        parsed = result.next;
        changed = true;
        applied.push(op);
      }
    }
    if (changed) files.push({ path: relPath, content: leadingComment(raw) + dumpYaml(parsed) });
  };
  await applyFile(TAXONOMY_PATH, list.filter((o) => o.kind === "label" || o.kind === "add"), (parsed, op) => op.kind === "add" ? addCategory(parsed, { parentPath: op.args?.parentPath ?? [], key: op.args?.key, label: op.args?.label }, actionCtx(ctx)) : renameLabel(parsed, { path: op.args?.path, label: op.args?.label }, actionCtx(ctx)), TaxonomyEditError);
  await applyFile(CONTENT_CHANNELS_PATH, list.filter((o) => o.kind === "channel-set" || o.kind === "channel-remove"), (parsed, op) => op.kind === "channel-set" ? setChannel(parsed, { category: op.args?.category, channelId: op.args?.channelId }, actionCtx(ctx)) : removeChannel(parsed, { category: op.args?.category }, actionCtx(ctx)), ContentChannelEditError);
  if (!files.length) return noop("every batched edit was already applied", { ops: list.length });
  const lines = Array.isArray(descriptions) && descriptions.length ? descriptions : list.map((o) => `${o.kind}: ${JSON.stringify(o.args)}`);
  const stamp = (ctx.now?.() ?? (/* @__PURE__ */ new Date()).toISOString()).replace(/[^0-9]/g, "").slice(0, 14);
  const pr = await adminPublish(ctx, {
    repo,
    branch: `gbti/category-batch-${stamp}`,
    files,
    message: `Categories: ${applied.length} change${applied.length === 1 ? "" : "s"}`,
    title: `Categories: ${applied.length} change${applied.length === 1 ? "" : "s"}`,
    body: `Batched category-workspace edits (SOW-100):

${lines.map((d) => `- ${d}`).join("\n")}`
  });
  return { ...pr, changed: true, applied: applied.length, skipped: list.length - applied.length };
}
async function setContentChannel(ctx, { category, channelId } = {}) {
  const slug = slugOf(String(category || ""));
  return editHouseYaml(ctx, CONTENT_CHANNELS_PATH, (parsed) => setChannel(parsed, { category, channelId }, actionCtx(ctx)), {
    branch: `gbti/content-channel-set-${slug}`,
    message: `Map category ${category} to Discord channel ${channelId}`,
    title: `Map category to Discord channel: ${category}`,
    noopMsg: `category already mapped to that channel: ${category}`,
    errType: ContentChannelEditError
  });
}
async function removeContentChannel(ctx, { category } = {}) {
  const slug = slugOf(String(category || ""));
  return editHouseYaml(ctx, CONTENT_CHANNELS_PATH, (parsed) => removeChannel(parsed, { category }, actionCtx(ctx)), {
    branch: `gbti/content-channel-remove-${slug}`,
    message: `Unmap category ${category} from its Discord channel`,
    title: `Unmap category channel: ${category}`,
    noopMsg: `no channel mapping for category: ${category}`,
    errType: ContentChannelEditError
  });
}
async function addModerationFlagTerm(ctx, { list, term } = {}) {
  const slug = slugOf(`${list}-${String(term || "").slice(0, 24)}`);
  return editHouseYaml(ctx, MODERATION_FLAGS_PATH, (parsed) => addFlagTerm(parsed, { list, term }, actionCtx(ctx)), {
    branch: `gbti/flag-term-add-${slug}`,
    message: `Add a ${list} moderation term`,
    title: `Add moderation term (${list})`,
    noopMsg: `term already in ${list}`,
    errType: ModerationFlagEditError
  });
}
async function removeModerationFlagTerm(ctx, { list, term } = {}) {
  const slug = slugOf(`${list}-${String(term || "").slice(0, 24)}`);
  return editHouseYaml(ctx, MODERATION_FLAGS_PATH, (parsed) => removeFlagTerm(parsed, { list, term }, actionCtx(ctx)), {
    branch: `gbti/flag-term-remove-${slug}`,
    message: `Remove a ${list} moderation term`,
    title: `Remove moderation term (${list})`,
    noopMsg: `term not in ${list}`,
    errType: ModerationFlagEditError
  });
}
async function setSyndicationTemplates(ctx, { edits } = {}) {
  requireRole(ctx, canManageRoles, "superadmin");
  const { repo } = requireRepo2(ctx);
  const list = Array.isArray(edits) ? edits : [];
  if (!list.length) return noop("no template edits", null);
  const raw = await ctx.reader?.readFile?.(SYNDICATION_CONFIG_PATH) || "";
  let parsed;
  try {
    parsed = index_vite_proxy_tmp_default.load(raw) || {};
  } catch {
    parsed = {};
  }
  const audits = [];
  let doc = parsed;
  let changed = 0;
  for (const e of list) {
    let result;
    try {
      result = setTemplate(doc, { type: e?.type, template: e?.template, channel: e?.channel, stub: e?.stub === true }, actionCtx(ctx));
    } catch (err) {
      if (err instanceof TemplateEditError) throw new OperationError("bad-request", err.message);
      throw err;
    }
    doc = result.next;
    audits.push(result.audit);
    if (result.changed) changed++;
  }
  if (!changed) return noop("no template changes", audits);
  const pr = await adminPublish(ctx, {
    repo,
    branch: "gbti/syndication-templates",
    files: [{ path: SYNDICATION_CONFIG_PATH, content: leadingComment(raw) + dumpYaml(doc) }],
    message: `Set ${changed} syndication template${changed === 1 ? "" : "s"}`,
    title: `Set syndication templates (${changed})`,
    body: prBody(null, audits),
    clobberOpenPull: true
  });
  return { ...pr, changed: true, count: changed, audit: audits };
}
async function setSyndicationTemplate(ctx, { type, template, channel, stub } = {}) {
  const slug = slugOf(`${channel ? `${channel}-` : ""}${stub ? "stub-" : ""}${String(type || "")}`);
  const label = channel ? `${channel} ${type}` : type;
  return editHouseYaml(ctx, SYNDICATION_CONFIG_PATH, (parsed) => setTemplate(parsed, { type, template, channel, stub }, actionCtx(ctx)), {
    branch: `gbti/syndication-template-${slug}`,
    message: `Set the ${label} syndication template`,
    title: `Set syndication template: ${label}`,
    noopMsg: `template unchanged: ${label}`,
    errType: TemplateEditError
  });
}
async function getSyndicationSettings(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  const cfg = syndicationConfigFromParsed(parsed);
  const channels = {};
  for (const name of SYNDICATION_CHANNEL_NAMES) channels[name] = Boolean(cfg.channels?.[name]);
  const autoMatrix = {};
  for (const t of AUTO_TYPES) {
    autoMatrix[t] = {};
    for (const ch of MATRIX_CHANNELS) autoMatrix[t][ch] = cfg.auto_matrix?.[t]?.[ch] ?? "off";
  }
  return {
    settings: {
      enabled: cfg.enabled,
      requireApproval: cfg.require_approval,
      holdMinutes: cfg.hold_minutes,
      channels,
      autoMatrix,
      channelHoldMinutes: { ...cfg.channel_hold_minutes }
    },
    channelNames: [...SYNDICATION_CHANNEL_NAMES],
    // SOW-125: matrixChannels (auto + manual) drive the matrix columns; autoChannels (auto-only) drive the
    // per-channel delay inputs; capability lets the UI derive auto/manual/building from ONE source.
    autoTypes: [...AUTO_TYPES],
    matrixChannels: [...MATRIX_CHANNELS],
    autoChannels: [...AUTO_CHANNELS],
    autoModes: [...AUTO_MODES],
    capability: { ...CHANNEL_CAPABILITY }
  };
}
async function setSyndicationSettings2(ctx, { enabled, requireApproval, holdMinutes, channels, autoMatrix, channelHoldMinutes } = {}) {
  return editHouseYaml(ctx, SYNDICATION_CONFIG_PATH, (parsed) => setSyndicationSettings(parsed, { enabled, requireApproval, holdMinutes, channels, autoMatrix, channelHoldMinutes }, actionCtx(ctx)), {
    branch: "gbti/syndication-settings",
    message: "Set the syndication pipeline settings",
    title: "Set syndication settings",
    noopMsg: "syndication settings unchanged",
    errType: TemplateEditError
  });
}
async function getNewsEngagementSettings(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  return { settings: { ...newsEngagement(syndicationConfigFromParsed(parsed)) }, tiers: [...NEWS_ENGAGEMENT_TIERS] };
}
async function setNewsEngagementSettings(ctx, { enabled, openThreshold, tier, commentAutopost } = {}) {
  return editHouseYaml(ctx, SYNDICATION_CONFIG_PATH, (parsed) => setNewsEngagement(parsed, { enabled, openThreshold, tier, commentAutopost }, actionCtx(ctx)), {
    branch: "gbti/news-engagement-set",
    message: "Set the news engagement auto-share settings",
    title: "Set news auto-share settings",
    noopMsg: "news engagement settings unchanged",
    errType: TemplateEditError
  });
}
async function getContentEngagementSettings(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  return { settings: { ...contentEngagement(syndicationConfigFromParsed(parsed)) }, tiers: [...NEWS_ENGAGEMENT_TIERS], signals: [...CONTENT_ENGAGEMENT_SIGNALS] };
}
async function setContentEngagementSettings(ctx, { enabled, threshold, tier, signals } = {}) {
  return editHouseYaml(ctx, SYNDICATION_CONFIG_PATH, (parsed) => setContentEngagement(parsed, { enabled, threshold, tier, signals }, actionCtx(ctx)), {
    branch: "gbti/content-engagement-set",
    message: "Set content engagement auto-share settings",
    title: "Set content engagement auto-share settings",
    noopMsg: "content engagement settings unchanged",
    errType: TemplateEditError
  });
}

// extension/src/ext-dispatch.mjs
var ADMIN_ACTIONS = { ban: banMember, unban: unbanMember, grandfather: grandfatherMember, ungrandfather: ungrandfatherMember, role: setMemberRole, deplatform: deplatformContent, remove: removeContent, republish: republishContent, "category-batch": applyCategoryBatch, "tag-edit": applyTagEdit, "category-add": addContentCategory, "category-rename": renameContentCategoryLabel, "news-source-add": addNewsSource, "news-source-remove": removeNewsSource, "news-source-toggle": setNewsSourceEnabled, "quote-add": addQuote2, "quote-remove": removeQuote2, "quote-toggle": setQuoteEnabled2, "content-channel-set": setContentChannel, "content-channel-remove": removeContentChannel, "flag-term-add": addModerationFlagTerm, "flag-term-remove": removeModerationFlagTerm, "syndication-template-set": setSyndicationTemplate, "syndication-templates-set": setSyndicationTemplates, "news-engagement-set": setNewsEngagementSettings, "content-engagement-set": setContentEngagementSettings, "syndication-settings-set": setSyndicationSettings2 };
var CODE_STATUS = Object.freeze({
  "no-identity": 409,
  "not-authenticated": 401,
  "not-found": 404,
  "bad-request": 400,
  "invalid-content": 400,
  "membership-required": 402,
  // SOW-011: publishing is paid-only
  forbidden: 403
});
var ok = (json2) => ({ status: 200, json: json2 });
async function computeRole(ctx) {
  const id = ctx.identity?.();
  if (!id?.githubId) return "member";
  const text = await ctx.reader.readFile("house/roles.yml");
  return roleOf(id.githubId, rolesFromText(text));
}
async function computeRoleAndCurate(ctx) {
  const id = ctx.identity?.();
  if (!id?.githubId) return { role: "member", canCurate: false };
  const text = await ctx.reader.readFile("house/roles.yml");
  const role = roleOf(id.githubId, rolesFromText(text));
  return { role, canCurate: canCurateNews(role, curatorsFromText(text).has(String(id.githubId))) };
}
function requireRepo3(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError("not-authenticated", "sign in first");
  return repo;
}
async function dispatch(ctx, { method = "GET", pathname, query = {}, body } = {}) {
  ctx.devlog?.("dispatch", "request", { method, pathname });
  try {
    const id = ctx.identity?.();
    if (pathname === "/api/status") {
      const membership = await (ctx.membershipResolved ? ctx.membershipResolved() : ctx.membership?.()) ?? "unknown";
      const { role, canCurate } = await computeRoleAndCurate(ctx);
      const live = Boolean(ctx.store?.get("githubToken"));
      return ok({
        version: "0.1.0",
        identity: live ? id ?? null : null,
        role,
        authenticated: live,
        membership,
        couponUntil: ctx.couponUntil?.() ?? null,
        // SOW-119 QA: the coupon-grant end date (the expiry countdown)
        paidTier: ctx.paidTier?.() ?? "none",
        // sow-185: the resolved paid TIER, for buildMemberSignal's page signal + any creator-tier UI (presentation only; authorizeCreator is the real gate)
        canPublish: membership === "paid",
        canStageDrafts: canStageDrafts(membership),
        // SOW-082: Save-draft is trial+paid (broader than canPublish)
        // SOW-060: free-tier perks (browse / news / save / follow) need only a signed-in identity, not paid.
        canSeeNews: canSeeNews(membership),
        canFollow: canFollow(membership),
        canSave: canSave(membership),
        canBrowse: canBrowse(membership),
        canCurate,
        sessionExpired: ctx.authExpired?.() === true
      });
    }
    if (pathname === "/api/onboarding-status") return ok(await getOnboardingStatus(ctx));
    if (pathname === "/api/taxonomy") return ok(await getTaxonomy(ctx));
    if (pathname === "/api/news-source-pool") return ok(await getNewsSourcePool(ctx));
    if (pathname === "/api/quote-pool") return ok(await getQuotePool(ctx));
    if (pathname === "/api/content-channel-pool") return ok(await getContentChannelPool(ctx));
    if (pathname === "/api/moderation-flag-pool") return ok(await getModerationFlagPool(ctx));
    if (pathname === "/api/syndication-template-pool") return ok(await getSyndicationTemplatePool(ctx));
    if (pathname === "/api/coupon-pool") return ok(await getCouponPool(ctx));
    if (pathname === "/api/news-engagement") return ok(await getNewsEngagementSettings(ctx));
    if (pathname === "/api/content-engagement") return ok(await getContentEngagementSettings(ctx));
    if (pathname === "/api/syndication-settings") return ok(await getSyndicationSettings(ctx));
    const username = id?.username;
    if (!username) throw new OperationError("no-identity", "no signed-in identity; sign in first");
    switch (pathname) {
      // SOW-145: route through the shared ops so the house scope + its superadmin re-check live in ONE place
      // (the ops are async-reader-aware). Member scope behaves exactly as the old inline reader call did.
      case "/api/content":
        return ok(await listContent(ctx, { type: query.type, scope: query.scope }));
      case "/api/content/item":
        return ok(await getContentItem(ctx, { path: query.path }));
      case "/api/read":
        return ok(await readContent(ctx, { path: query.path }));
      // shared op (parity with the npm host /api/read)
      case "/api/members-content":
        return ok(await listMembersOnly(ctx));
      case "/api/form-fields":
        return ok({ fields: fieldsFor(query.type) ?? [] });
      case "/api/preview":
        return ok({ html: renderMarkdown(body?.body ?? "") });
      case "/api/validate":
        return ok(validateContent(ctx, body));
      // reader-free
      case "/api/publish":
        return ok(await publish(ctx, body));
      // reader-free (uses content-ops + the repo client)
      case "/api/content/status":
        return ok(await setOwnContentStatus(ctx, body ?? {}));
      case "/api/content/rename":
        return ok(await renameContent(ctx, body ?? {}));
      case "/api/image":
        return ok(await stageImage(ctx, body ?? {}));
      // SOW-082: universal draft staging (Save to the fork without a PR; review; Publish from the staged branch).
      case "/api/drafts":
        return ok(await listDrafts(ctx, { type: query.type }));
      case "/api/draft":
        return ok(method === "POST" ? await saveDraft(ctx, body) : await readDraft(ctx, { type: query.type, slug: query.slug, store: query.store, path: query.path }));
      case "/api/draft/discard":
        return ok(await discardDraft(ctx, body));
      case "/api/draft/publish":
        return ok(await publishDraft(ctx, body));
      case "/api/share":
        return ok(await publishShare(ctx, body));
      // SOW-018: reader-free; members Share encrypts via the Worker
      case "/api/shares":
        return ok(await listShares(ctx, { limit: Number(query.limit) || void 0 }));
      // SOW-018 feed (Git Trees enumerate)
      case "/api/share-comments":
        return ok(await listShareComments(ctx, { targetSlug: query.targetSlug, limit: Number(query.limit) || void 0 }));
      // SOW-032 discussion (Git Trees enumerate)
      case "/api/comments":
        return ok(await listComments(ctx, { targetType: query.targetType, targetSlug: query.targetSlug, limit: Number(query.limit) || void 0, aliases: query.aliases ? String(query.aliases).split(",").filter(Boolean) : [] }));
      // SOW-041 discussion (+ SOW-112 rename aliases)
      case "/api/comment":
        return ok(method === "POST" ? await publishComment(ctx, body) : await getComment(ctx, { id: query.id }));
      case "/api/comment/edit":
        return ok(await editComment(ctx, body));
      // SOW-027: re-publish with updatedAt set
      case "/api/comment/delete":
        return ok(await deleteComment(ctx, body ?? {}));
      case "/api/member-decrypt":
        return ok(await decryptMemberAsset(ctx, body));
      // SOW-016: reads the .enc via the reader, decrypts via the Worker
      case "/api/activity":
        return ok(method === "POST" ? await mutateMemberActivity(ctx, body) : await getMemberActivity(ctx));
      case "/api/earnings":
        return ok(await getMemberEarnings(ctx));
      case "/api/follows":
        return ok(method === "POST" ? await setFollow2(ctx, body) : await getFollows2(ctx));
      case "/api/upvote":
        return ok(await upvoteContent(ctx, body ?? {}));
      case "/api/og-preview":
        return ok(await ogPreview2(ctx, body ?? {}));
      case "/api/discord-invite":
        return ok(await getDiscordInvite2(ctx));
      case "/api/discord-link":
        return ok(await getDiscordLinkUrl(ctx));
      case "/api/discord-link/status":
        return ok(await getDiscordLinkStatus(ctx));
      case "/api/news":
        return ok(await getNews(ctx, { category: query.category, since: query.since, limit: Number(query.limit) || void 0 }));
      case "/api/news-sources":
        return ok(await getNewsSources(ctx));
      case "/api/prefs":
        return ok(method === "POST" ? await setPrefs(ctx, body) : await getPrefs(ctx));
      case "/api/news-publish":
        return ok(await publishNews(ctx, body ?? {}));
      case "/api/news-discussed":
        return ok(await reflectNewsDiscussion(ctx, body ?? {}));
      case "/api/news-opened":
        return ok(await recordNewsOpen(ctx, body ?? {}));
      case "/api/content-opened":
        return ok(await recordContentOpen(ctx, body ?? {}));
      case "/api/billing":
        return ok(getBilling(ctx));
      case "/api/referral":
        return ok(getReferral(ctx));
      case "/api/prs":
        return ok({ prs: await requireRepo3(ctx).listMyPulls(id.login) });
      case "/api/contributions":
        return ok(await listIncomingContributions(ctx));
      case "/api/contribution":
        return ok(await getContributionReview(ctx, { number: query.number }));
      case "/api/contribution-review":
        return ok(await reviewContribution(ctx, body));
      case "/api/overrides":
        return ok(await getOverridesRoster(ctx));
      // SOW-079: /api/taxonomy, /api/news-source-pool, /api/quote-pool moved ABOVE the identity gate (public reads).
      case "/api/open-pulls":
        return ok(await getOpenPulls(ctx));
      case "/api/syndication":
        return ok(await getSyndicationQueue2(ctx));
      case "/api/syndication/approve":
        return ok(await approveSyndication2(ctx, body ?? {}));
      case "/api/syndication/cancel":
        return ok(await cancelSyndication2(ctx, body ?? {}));
      case "/api/syndicate-now":
        return ok(method === "POST" ? await syndicateNow2(ctx, body ?? {}) : await getSyndicateNowInfo(ctx));
      case "/api/social-queue":
        return ok(method === "POST" ? await socialQueueAction2(ctx, body ?? {}) : await getSocialQueue2(ctx));
      case "/api/discord-channels":
        return ok(await listDiscordChannels(ctx));
      case "/api/admin-ops":
        return ok(await triggerAdminOp2(ctx, body ?? {}));
      case "/api/coupon-usage":
        return ok(await getCouponUsageOp(ctx));
      case "/api/coupon-refresh":
        return ok(await refreshCouponUntil(ctx));
      case "/api/pr-status": {
        const n = Number(query.number);
        if (!Number.isInteger(n) || n <= 0) throw new OperationError("bad-request", "a positive PR number is required");
        return ok(await requireRepo3(ctx).gateStatus(n));
      }
      case "/api/admin": {
        const role = await computeRole(ctx);
        const adminCtx = { ...ctx, role: () => role, store: { get: (k) => k === "repoPath" ? "extension" : ctx.store?.get(k) } };
        const fn = ADMIN_ACTIONS[body?.action];
        if (!fn) throw new OperationError("bad-request", `unknown admin action: ${body?.action}`);
        return ok(await fn(adminCtx, body ?? {}));
      }
      default:
        return { status: 404, json: { error: "not_found" } };
    }
  } catch (err) {
    if (err instanceof OperationError) {
      ctx.devlog?.("dispatch", "operation error", { pathname, code: err.code, message: err.message });
      return { status: CODE_STATUS[err.code] ?? 400, json: { error: err.code, message: err.message } };
    }
    ctx.devlog?.("dispatch", "internal error", { pathname, message: err?.message });
    return { status: 500, json: { error: "internal", message: err?.message } };
  }
}

// client/src/auth-device.mjs
var GITHUB = "https://github.com";
var FORM = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };
async function requestDeviceCode({ clientId, scope = "public_repo read:user", fetch: fetch2 = globalThis.fetch }) {
  if (!clientId) throw new Error("requestDeviceCode: clientId is required");
  const res = await fetch2(`${GITHUB}/login/device/code`, {
    method: "POST",
    headers: FORM,
    body: new URLSearchParams({ client_id: clientId, scope }).toString()
  });
  if (!res.ok) throw new Error(`device code request failed: ${res.status}`);
  return res.json();
}
async function pollForToken({ clientId, deviceCode, fetch: fetch2 = globalThis.fetch }) {
  const res = await fetch2(`${GITHUB}/login/oauth/access_token`, {
    method: "POST",
    headers: FORM,
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    }).toString()
  });
  return res.json();
}
var defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function deviceFlowLogin({
  clientId,
  scope,
  fetch: fetch2 = globalThis.fetch,
  onPrompt,
  sleep = defaultSleep,
  now = () => Date.now()
}) {
  const dc = await requestDeviceCode({ clientId, scope, fetch: fetch2 });
  if (typeof onPrompt === "function") {
    onPrompt({ userCode: dc.user_code, verificationUri: dc.verification_uri, expiresIn: dc.expires_in });
  }
  let interval = (Number(dc.interval) || 5) * 1e3;
  const deadline = now() + (Number(dc.expires_in) || 900) * 1e3;
  for (; ; ) {
    if (now() >= deadline) throw new Error("device flow expired before authorization");
    await sleep(interval);
    const r = await pollForToken({ clientId, deviceCode: dc.device_code, fetch: fetch2 });
    if (r.access_token) {
      return {
        accessToken: r.access_token,
        scope: r.scope,
        refreshToken: r.refresh_token,
        // present only when the App expires user tokens
        expiresIn: Number(r.expires_in) || 0,
        // seconds until the access token dies (~28800 = 8h)
        refreshTokenExpiresIn: Number(r.refresh_token_expires_in) || 0
        // ~15897600 = 6mo
      };
    }
    switch (r.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += 5e3;
        break;
      case "expired_token":
        throw new Error("device flow expired before authorization");
      case "access_denied":
        throw new Error("device flow denied by the user");
      default:
        throw new Error(`device flow error: ${r.error ?? "unknown"}`);
    }
  }
}

// extension/src/open-page.mjs
var PAGES = /* @__PURE__ */ new Set([
  "newtab.html",
  "workspace.html",
  "browse.html",
  // RETIRED page, aliased to newtab.html below (old locked-content CTAs still send it)
  "shares.html",
  "admin.html",
  "account.html",
  "onboarding.html"
]);
var HASH_RE = /^[A-Za-z0-9=&_%.,-]{1,300}$/;
var PAGE_ALIAS = { "browse.html": "newtab.html" };
function resolveOpenPage({ page, hash: hash2 } = {}) {
  if (typeof page !== "string" || !PAGES.has(page)) return null;
  const target = PAGE_ALIAS[page] || page;
  if (hash2 == null || hash2 === "") return target;
  const h = String(hash2).replace(/^#/, "");
  if (h === "") return target;
  if (!HASH_RE.test(h)) return null;
  return `${target}#${h}`;
}

// extension/src/token-refresh.mjs
var SKEW_MS = 6e4;
function needsRefresh(s = {}, now = Date.now(), skewMs = SKEW_MS) {
  if (!s.githubToken || !s.githubRefreshToken || !s.githubTokenExpiresAt) return false;
  return now >= Number(s.githubTokenExpiresAt) - skewMs;
}
function refreshPatch(resp, oldRefreshToken, now = Date.now()) {
  if (!resp || !resp.access_token) return null;
  return {
    githubToken: resp.access_token,
    githubRefreshToken: resp.refresh_token || oldRefreshToken || null,
    githubTokenExpiresAt: now + (Number(resp.expires_in) || 0) * 1e3
  };
}

// extension/src/background.mjs
var SIGNUP_BASE2 = "https://signup.gbti.network";
var storePromise = null;
function getStore() {
  if (!storePromise) {
    storePromise = chrome.storage.local.get("gbti").then(
      (d) => createExtStore(d?.gbti ?? {}, (next) => chrome.storage.local.set({ gbti: next }))
    );
  }
  return storePromise;
}
async function handleLogin(store) {
  const { accessToken, refreshToken, expiresIn } = await deviceFlowLogin({
    // SOW-026: classic mode = the public_repo OAuth app (account-wide); app mode = the GitHub App (fork-scoped,
    // no scope, GitHub Apps ignore it). The token only ever reaches GitHub; app mode shrinks its capability to
    // the member's single fork. The MV3 worker has no process.env, so AUTH_MODE defaults to classic until the
    // bundle bakes app mode at provisioning.
    clientId: activeClientId(),
    scope: activeScope(),
    onPrompt: ({ userCode, verificationUri }) => {
      chrome.runtime.sendMessage({ type: "login-prompt", userCode, verificationUri }).catch(() => {
      });
    }
  });
  const repo = createRepoClient({ token: accessToken, upstream: UPSTREAM });
  const u = await repo.getAuthUser();
  store.set({
    githubToken: accessToken,
    githubRefreshToken: refreshToken || null,
    githubTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1e3 : null,
    identity: { login: u.login, githubId: String(u.id), username: String(u.login).toLowerCase() }
  });
  if (!store.get("authMode")) {
    try {
      const probe = await probeReadiness({ token: accessToken, appSlug: GITHUB_APP_SLUG, upstream: UPSTREAM, fetch: globalThis.fetch });
      const mode = decideAuthMode(probe);
      if (mode) store.set({ authMode: mode });
    } catch {
    }
  }
  try {
    const reader = createGithubReader({ upstream: UPSTREAM, token: accessToken });
    const { stripeStatus, membership, couponUntil, paidTier } = await resolveMembership({ githubId: String(u.id), token: accessToken, signupBase: SIGNUP_BASE2, readFile: (p) => reader.readFile(p) });
    store.set({ stripeStatus, membership, couponUntil: couponUntil ?? null, paidTier: paidTier ?? "none" });
  } catch {
  }
  try {
    await chrome.storage?.session?.set?.({ webSessionMinted: true });
  } catch {
  }
  mintWebSession(accessToken);
  return { ok: true, login: u.login };
}
async function refreshViaWorker(refreshToken) {
  const res = await fetch(`${SIGNUP_BASE2}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  return res.json();
}
async function mintWebSession(token) {
  if (!token) return;
  try {
    await fetch(`${SIGNUP_BASE2}/auth/session-from-token`, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
  }
}
async function maybeMintWebSession(store) {
  try {
    const token = store.get("githubToken");
    if (!token) return;
    const { webSessionMinted } = await chrome.storage?.session?.get?.("webSessionMinted") ?? {};
    if (webSessionMinted) return;
    await chrome.storage?.session?.set?.({ webSessionMinted: true });
    await mintWebSession(token);
  } catch {
  }
}
async function clearWebSession(token) {
  if (!token) return;
  try {
    await fetch(`${SIGNUP_BASE2}/auth/session-clear`, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
  }
}
var _refreshing = null;
async function ensureFreshToken(store) {
  const state = { githubToken: store.get("githubToken"), githubRefreshToken: store.get("githubRefreshToken"), githubTokenExpiresAt: store.get("githubTokenExpiresAt") };
  if (!needsRefresh(state)) return;
  if (!_refreshing) {
    const old = state.githubRefreshToken;
    _refreshing = (async () => {
      try {
        const patch = refreshPatch(await refreshViaWorker(old), old);
        if (patch) store.set(patch);
      } catch {
      } finally {
        _refreshing = null;
      }
    })();
  }
  return _refreshing;
}
var ONBOARDING_PAGE = "onboarding.html";
async function openOnboardingTab() {
  const url2 = chrome.runtime.getURL(ONBOARDING_PAGE);
  try {
    const { onboardingTabId } = await chrome.storage?.session?.get?.("onboardingTabId") ?? {};
    if (onboardingTabId != null) {
      try {
        const t = await chrome.tabs.get(onboardingTabId);
        await chrome.tabs.update(onboardingTabId, { active: true });
        if (t?.windowId != null) await chrome.windows.update(t.windowId, { focused: true });
        return;
      } catch {
      }
    }
    const created = await chrome.tabs.create({ url: url2 });
    if (created?.id != null) await chrome.storage?.session?.set?.({ onboardingTabId: created.id });
  } catch {
    try {
      await chrome.tabs.create({ url: url2 });
    } catch {
    }
  }
}
chrome.action?.onClicked?.addListener(() => {
  openOnboardingTab();
});
async function broadcastAuthChanged() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://gbti.network/*" });
    for (const t of tabs) if (t.id != null) chrome.tabs.sendMessage(t.id, { type: "auth-changed" }).catch(() => {
    });
  } catch {
  }
}
async function focusTab(tabId, windowId) {
  if (tabId == null) return;
  try {
    await chrome.tabs.update(tabId, { active: true });
    if (windowId != null) await chrome.windows.update(windowId, { focused: true });
  } catch {
  }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const store = await getStore();
    try {
      if (msg?.type === "api") {
        await ensureFreshToken(store);
        maybeMintWebSession(store);
        sendResponse(await dispatch(buildExtContext(store), msg.req || {}));
      } else if (msg?.type === "login") {
        const res = await handleLogin(store);
        if (res?.ok) {
          broadcastAuthChanged();
          await focusTab(sender?.tab?.id, sender?.tab?.windowId);
        }
        sendResponse(res);
      } else if (msg?.type === "signout") {
        clearWebSession(store.get("githubToken"));
        store.set({ githubToken: null, githubRefreshToken: null, githubTokenExpiresAt: null, identity: null });
        try {
          const all = await chrome.storage.local.get(null);
          const keys = Object.keys(all || {}).filter((k) => k.startsWith("gbti:wb:") || k === "gbti:create-recent");
          if (keys.length) await chrome.storage.local.remove(keys);
        } catch {
        }
        try {
          await chrome.storage?.session?.remove?.("webSessionMinted");
        } catch {
        }
        broadcastAuthChanged();
        sendResponse({ ok: true });
      } else if (msg?.type === "open-page") {
        const rel = resolveOpenPage({ page: msg.page, hash: msg.hash });
        if (!rel) {
          sendResponse({ ok: false, error: "bad_page" });
          return;
        }
        try {
          await chrome.tabs.create({ url: chrome.runtime.getURL(rel) });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message ?? "open_failed" });
        }
      } else if (msg?.type === "devlog-recent" || msg?.type === "devlog-clear") {
        let role = "member";
        try {
          role = await computeRole(buildExtContext(store));
        } catch {
          role = "member";
        }
        if (role !== "superadmin") {
          sendResponse({ ok: false, error: "forbidden" });
          return;
        }
        if (msg.type === "devlog-clear") {
          devlog.clear();
          sendResponse({ ok: true });
        } else sendResponse({ ok: true, entries: devlog.recent() });
      } else {
        sendResponse({ error: "unknown_message" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message ?? String(err) });
    }
  })();
  return true;
});
