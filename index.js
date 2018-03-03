const crypto = require('crypto');

NULL_BALLOT = [0,null];

class Node {
    constructor(id, options) {
        this._id = id;
        this._startTime = options.startTime;
        this._roundLength = options.roundLength || 3000;
        this._pendingTxs = [];
        this._txNum = 0;
        this._slots = {};
    }

    setQuorum(peers) {
        if (!peers.find(peer => peer._id == this._id)) {
            peers.push(this);
        }
        this._peers = peers;
    }

    start() {
        this.closeLedger();
        setInterval(() => {
            this.makeNoise();
        }, 100);
    }

    initSlot(id) {
        this._slots[id] = {
            nominate: {
                votes: [],
                accepted: [],
                candidates: [],
                nominations: {}
            },
            ballot: {
                phase: "PREPARE",
                ballot: NULL_BALLOT,
                pp: NULL_BALLOT,
                p: NULL_BALLOT,
                c: NULL_BALLOT,
                h: NULL_BALLOT,
                z: null,
                other_ballots: {}
            }
        }
    }

    closeLedger() {
        console.log(`Closing ledger ${this.currentSlot()} for ${this._id}`)
        if (this._pendingTxs.length > 0) {
            this.initSlot(this.currentSlot());
            this.nominate();
        }
        this._pendingTxs = [];

        const delay = this.nextLedgerTime() - Date.now();
        setTimeout(() => {
            this.closeLedger();
        }, delay);
    }

    nominate() {
        const message = {
            slot: this.currentSlot(),
            
        }
    }

    nextLedgerTime() {
        const now = Date.now();
        return now - (now % this._roundLength) + this._roundLength;
    }

    currentSlot() {
        return Math.floor((Date.now() - this._startTime)/this._roundLength)
    }

    prioritizedPeers() {
        return this._peers.map(peer => {
            return {
                peer: peer,
                priority: crypto.createHash('sha256').update(String(peer._id), this._currentSlot).digest()
            }
        }).sort((a,b) => {
            return (a.priority < b.priority) ? 1 : -1;
        }).map(priorityPeer => priorityPeer.peer);
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
                this._pendingTxs.push(data);
                break;
            case 'nominate':
                // In real life, verify signature of nomination
                if (this.isNewerNomination(data) && 
                this._pendingNominations[data.id] = data;
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
n1.setQuorum([n1,n3,n4]);
n2.setQuorum([n1,n3,n4]);
n3.setQuorum([n1,n2,n4]);
n4.setQuorum([n1,n2,n3]);

n1.start();
n2.start();
n3.start();
n4.start();
