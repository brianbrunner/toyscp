module.exports.deepEquals = function deepEquals(a,b) {
    return JSON.stringify(a) == JSON.stringify(b);
}

module.exports.deepContains = function deepContains(arr, search) {
    const jsonSearch = JSON.stringify(search);
    return !!arr.find(val => jsonSearch === JSON.stringify(val));
}

module.exports.clone = function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
