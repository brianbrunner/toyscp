module.exports.deepEquals = function deepEquals(a,b) {
    return JSON.stringify(a) == JSON.stringify(b);
}

var deepContains = module.exports.deepContains = function deepContains(arr, search) {
    const jsonSearch = JSON.stringify(search);
    return !!arr.find(val => jsonSearch === JSON.stringify(val));
}

module.exports.clone = function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

module.exports.deepUnique = function deepUnique(arr) {
    const uniqueArr = [];
    arr.forEach(item => {
        if (!deepContains(uniqueArr, item)) {
            uniqueArr.push(item);
        }
    });
    return uniqueArr;
}

module.exports.VALUE_STATE = {
    VALID: 'valid',
    INVALID: 'invalid',
    MAYBE_VALID: 'maybe_valid'
}
