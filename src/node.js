const crypto = require('crypto');

const Slot = require('./slot');
const utils = require('./utils');

const VALUE_STATE = utils.VALUE_STATE;

class Node {
    constructor(id, options) {
        this.id = id;
        this.startTime = options.startTime;
        this.roundLength = options.roundLength || 3000;
        this.numSlots = options.numSlots;
        this.pendingTxs = [];
        this.txNum = 0;
        this.slots = {};
    }

    setQuorum(peers) {
        if (!peers.find(peer => peer.id == this.id)) {
            peers.push(this);
        }
        this.peers = peers;
        this.threshold = Math.ceil(this.peers.length*0.5);
    }

    quorumSetHash() {
        var hash = crypto.createHash('sha256');
        this.prioritizedPeers(0,0).forEach(peer => hash = hash.update(String(peer.id)));
        return hash.digest('hex');
    }

    start() {
        this.closeLedger();
        this.noiseInterval = setInterval(() => {
            this.makeNoise();
        }, 100);
    }

    stop() {
        clearInterval(this.noiseInterval);
    }

    getSlot(id) {
        if (!this.slots[id]) {
            this.slots[id] = new Slot(id, this);
        }
        return this.slots[id];
    }

    closeLedger() {
        if (this.pendingTxs.length > 0) {
            this.getSlot(this.currentSlotId()).nominate(this.pendingTxs);
        }
        this.pendingTxs = [];

        if (!this.numSlots || this.numSlots > Object.keys(this.slots).length) {
            const delay = this.nextLedgerTime() - Date.now();
            setTimeout(() => {
                this.closeLedger();
            }, delay);
        } else {
            this.stop()
        }
    }

    nextLedgerTime() {
        const now = Date.now();
        return now - (now % this.roundLength) + this.roundLength;
    }

    currentSlotId() {
        return Math.floor((Date.now() - this.startTime)/this.roundLength)
    }

    prioritizedPeers(slotId, roundNumber) {
        slotId = slotId || this.currentSlotId();
        return this.peers.map(peer => {
            return {
                peer: peer,
                priority: crypto.createHash('sha256').update(String(peer.id)).update(String(slotId))
                    .update(String(roundNumber)).digest('hex')
            }
        }).sort((a,b) => {
            return (a.priority < b.priority) ? 1 : -1;
        });
    }

    broadcast(topic, data) {
        setTimeout(() => {
            data.from = this.id;
            this.peers.forEach(function(peer) {
                peer.send(topic, data);
            });
        });
    }

    send(topic, data) {
        // In real life, verify signature of message
        switch(topic) {
            case 'tx':
                // In real life, validate tx first
                this.pendingTxs.push(data);
                break;
            case 'nominate':
                var slot = this.getSlot(data.slot);
                slot.processNomination(data);
                break;
            case 'prepare':
            case 'confirm':
            case 'externalize':
                var slot = this.getSlot(data.slot);
                slot.processBallot(data);
                break;
            default:
                break;
        }
    }

    isQuorumSlice(nodes) {

        var thresholdLeft = this.threshold;

        for (var i = 0; i < this.peers.length; i++) {
            const peer = this.peers[i];
            if (nodes.find(node => peer.id === node.id || peer.id === node)) {
                thresholdLeft -= 1;
                if (thresholdLeft <= 0) {
                    return true;
                }
            }
        }

        return false;

    }

    isVBlocking(nodes) {

        if (this.threshold == 0) {
            return false;
        }

        var leftTillBlock = (1 + this.peers.length) - this.threshold;

        for (var i = 0; i < this.peers.length; i++) {
            const peer = this.peers[i];
            if (nodes.find(node => peer.id === node.id || peer.id === node)) {
                leftTillBlock -= 1;
                if (leftTillBlock <= 0) {
                    return true;
                }
            }
        }

        return false;

    }

    combineCandidates(slotIndex, candidates) {
        var longest = [];
        candidates.forEach(candidate => {
            if (candidate.length > longest.length) {
                longest = candidate;
            }
        });
        return longest;
    }

    validateValue(value) {
        console.log(value);
        return VALUE_STATE.VALID;
    }

    makeNoise() {
        if (Math.random() > .90) {
            this.broadcast('tx', {
                id: this.id,
                tx: this.txNum++,
                timestamp: Date.now()
            });
        }
    }
}

module.exports = Node;
