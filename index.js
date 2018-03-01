const crypto = require('crypto');

class Node {
    constructor(id, options) {
        this._id = id;
        this._startTime = options.startTime;
        this._roundLength = options.roundLength || 3000;
        this._pendingTxs = [];
        this._txNum = 0;
    }

    setPeers(peers) {
        this._peers = peers;
    }

    start() {
        this.doLedgerClose();
        setInterval(() => {
            this.makeNoise();
        }, 100);
    }

    compositeValue() {
        
    }

    doLedgerClose() {
        console.log(`Closing ledger ${this.currentBallot()} for ${this._id}`)
        if (this._pendingTxs.length > 0) {
            this.nominate(
        }

        const delay = this.nextLedgerTime() - Date.now();
        setTimeout(() => {
            this.doLedgerClose();
        }, delay);
    }

    nextLedgerTime() {
        const now = Date.now();
        return now - (now % this._roundLength) + this._roundLength;
    }

    currentBallot() {
        return Math.floor((Date.now() - this._startTime)/this._roundLength)
    }

    prioritizedPeers() {
        return this._peers.map(function() {
            return {
                peer: peer,
                priority: crypto.createHash('sha256').update(peer._id, this._currentBallot).digest()
            }
        }).sort(function(a,b) {
            return (a.priority < b.priority) ? 1 : -1;
        }).map(function(priorityPeer) {
            return priorityPeer.peer;
        });
    }

    broadcast(topic, data) {
        this._peers.forEach(function(peer) {
            peer.send(topic, data);
        });
    }

    send(topic, data) {
        console.log(`Node ${this._id} on topic "${topic}" recevied:`, data);
        switch(topic) {
            case 'tx':
                // In real life, validate tx first
                this._pendingTransactions.push(data);
            case 'nominate':
                // In real life, verify signature of nomination
                const prioritizedPeers = this.prioritizedPeers();
                if (prioritizedPeers[0].id == data.id) {
                } else {
                    this._pendingNominations[data.id] = data;
                }
                break;
            case 'prepare':

                break;
            case 'confirm':

                break;
            case 'externalize':
                break;
            default:
                break;
        }
    }

    makeNoise() {
        if (Math.random() > .9) {
            this.broadcast('tx', {
                id: this._id,
                tx: this._txNum++,
                timestamp: Date.now()
            });
        }
    }    
}

const startTime = Date.now();
const options = {
    startTime: startTime
};
const n1 = new Node(1, options);
const n2 = new Node(2, options);
const n3 = new Node(3, options);
const n4 = new Node(4, options);
const n5 = new Node(5, options);
const n6 = new Node(6, options);
n1.setPeers([n2,n3,n4]);
n2.setPeers([n1,n3,n4]);
n3.setPeers([n1,n2,n4]);
n4.setPeers([n1,n2,n3]);

n1.start();
n2.start();
n3.start();
n4.start();
