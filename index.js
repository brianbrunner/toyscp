const Node = require('./src/node');

const startTime = Date.now();
const options = {
    startTime: startTime,
    numSlots: 1
};
const n1 = new Node(1, options);
const n2 = new Node(2, options);
const n3 = new Node(3, options);
n1.setQuorum([n2,n3]);
n2.setQuorum([n1,n3]);
n3.setQuorum([n1,n2]);

n1.start();
n2.start();
n3.start();
