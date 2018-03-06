// LIMITIATIONS
// Quorums:
// * There is no ability to designate subquorums, just peers
// * Threshold for a quorum isn't customizable, locked at 50% agreement

const crypto = require('crypto');

NULL_BALLOT = [0,null];

function deepContains(arr, search) {
    const jsonSearch = JSON.stringify(search);
    return !!arr.find(val => jsonSearch === JSON.stringify(val));
}

class Slot {
    constructor(index, node) {
        this._index = index;
        this._node = node;
        this.nominate = {
            latestData: {}
            votes: [],
            accepted: [],
            candidates: [],
            nominations: {}
        }
        this.nominationStarted = false;
        this.ballot = {
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

    /**
     * Methods For Establishing Consensus
     */

    roundLeaderIds() {
        if (!this._roundLeaderIds) {
            const prioritizedPeers = this.node.prioritizedPeers(this._index);
            this._roundLeaderIds = prioritizedPeers.filter(peer => peer.priority === prioritizedPeers[0].priority);
        }
        return this._roundLeaderIds;
    }

    federatedAccept(votesNodesFn, acceptedNodesFn, vote) {

        const acceptedNodeIds = acceptedNodesFn(vote);

        if (this._node.isVBlocking(acceptedNodeIds)) {
            return true;
        }

        const combinedNodeIds = votesNodesFn(vote);
        acceptedNodeIds.filter(id => combinedNodeIds.indexOf(id) === -1)
            .forEach(id => combinedNodeIds.push(id));

        if (this._node.isQuorumSlice(combinedNodeIds)) {
            return true;
        }

        return false;

    }

    federatedRatify(acceptedNodesFn, vote) {
        const acceptedNodeIds = acceptedNodesFn(vote);
        return this._node.isQuorumSlice(acceptedNodeIds);
    }

    /**
     * Nomination Protocol 
     */

    isSubset(a, b) {
        return a.length <= b.length &&
            a.some(val => b.indexOf(val) !== -1);
    }

    isNewerStatement(data) {
        const old = this.nominate.nominations[data.from];
        if (old) {
            if (this.isSubset(old.votes, data.votes)
                    && this.isSubset(old.accepted, data.accepted)
                    && (old.votes.length == data.votes.length
                        || old.accepted.length < votes.accepted.length) {
                return true;
            }
        } else {
            return true;
        }
    }

    isSorted(array) {
        for (var i = 0; i < array.length - 1; i++) {
            var a = array[i];
            var b = array[i+1];
            /*
            // TODO need to understand how to sort values
            if (a > b) {
                return false
            }
            */
        }
        return true;
    }

    isSane(data) {
        return (data.votes.length || data.accepted.length)
            && this.isSorted(data.votes)
            && this.isSorted(data.accepted);
    }

    recordData(data) {
        this.nominate.latestData[data.from] = data;
    }

    nominateAcceptedNodesFn(vote) {
        return this.nominate.nominations
            .filter(nomination => deepContains(nomination.accepted, vote))
            .map(nomination => nomination.from);
    }

    nominateVotesNodesFn(vote) {
        return this.nominate.nominations
            .filter(nomination => deepContains(nomination.votes, vote))
            .map(nomination => nomination.from);
    }

    processNomination(data) {
    
        if (this.isNewerStatement(data)) {

            if (this.isSane(data)) {

                this.recordData(data);

                if (this.nominationStarted) {

                    var modified = false;
                    var newCandidates = false;

                    data.votes.forEach(vote => {

                        if (deepContains(this.nominate.accepted, vote)) {
                            return;
                        }

                        if (this.federatedAccept(this.nominateAcceptedNodesFn.bind(this), 
                                this.nominateVotesNodesFn.bind(this),
                                vote)) {

                            // In the real world, we would validate the value here
                            this.nominate.votes.push(vote);
                            this.nominate.accepted.push(vote);
                            modified = true;

                        }

                    });

                    data.accepted.forEach(accepted => {

                        if (deepContains(this.nominate.candidates, accepted)) {
                            return;
                        }

                        if (this.federatedRatify(this.nominateAcceptedNodesFn.bind(this), vote)) {
                            this.nominate.candidates.push(vote);
                            newCandidates = true;
                        }

                    });

                    if (this.nominate.candidates.length === 0
                            && this.roundLeaderIds().indexOf(data.from) !== -1) {
                        const newVote = this.getNewValueFromNomination(data);
                        if (newVote) {
                            this.nominate.votes.push(newVote);
                            modified = true;
                            this.node.nominatingValue(this._index, newVote);
                        }
                    }

                    if (modified) {
                        this.emitNomination();
                    }

                    if (newCandidates) {
                        const latestCompositeCandidate = this.node.combineCandidates(this.index, this.nominate.candidates);
                        this.node.updatedCompositeCandidate(latestCompositeCandidate);
                        this.bumpState(latestCompositeCandidate, false);
                    }

                }
            }
        }

    }

    getNewValueFromNomination(nomination) {
        var newVote;
        var newHash = '';

        nomination.votes
            .concat(nomination.accepted)
            .forEach(vote => {
                if (!deepContains(this.votes, vote)) {
                    const hash = crypto.createHash('sha256').update(String(peer._id), slotId).digest()
                    if (hash > newHash) {
                        newVote = vote;
                    }
                }
            });
        return newVote;
    }

    /**
     * Ballot Protocol 
     */

    processBallot() {

    }
}

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
        this._threshold = Math.ceil(this._peers.length*0.5);
    }

    start() {
        this.closeLedger();
        setInterval(() => {
            this.makeNoise();
        }, 100);
    }

    getSlot(id) {
        if (!this._slots[id]) {
            this._slots[id] = new Slot(id, this);
        }
        return this._slots[id];
    }

    closeLedger() {
        if (this._pendingTxs.length > 0) {
            this.nominate();
        }
        this._pendingTxs = [];

        const delay = this.nextLedgerTime() - Date.now();
        setTimeout(() => {
            this.closeLedger();
        }, delay);
    }

    nextLedgerTime() {
        const now = Date.now();
        return now - (now % this._roundLength) + this._roundLength;
    }

    currentSlot() {
        return Math.floor((Date.now() - this._startTime)/this._roundLength)
    }

    prioritizedPeers(slotId) {
        slotId = slotId || this._currentSlot;
        return this._peers.map(peer => {
            return {
                peer: peer,
                priority: crypto.createHash('sha256').update(String(peer._id), slotId).digest()
            }
        }).sort((a,b) => {
            return (a.priority < b.priority) ? 1 : -1;
        });
    }

    broadcast(topic, data) {
        data.from = this._id;
        this._peers.forEach(function(peer) {
            peer.send(topic, data);
        });
    }

    send(topic, data) {
        console.log(`Node ${this._id} on topic "${topic}" recevied:`, data);
        // In real life, verify signature of message
        switch(topic) {
            case 'tx':
                // In real life, validate tx first
                this._pendingTxs.push(data);
                break;
            case 'nominate':
                const slot = this.getSlot(data.slot);
                slot.processNomination(data);
                break;
            case 'prepare':
            case 'confirm':
            case 'externalize':
                const slot = this.getSlot(data.slot);
                slot.processBallot(data);
                break;
            default:
                break;
        }
    }

    isQuorumSlice(nodes) {

        var thresholdLeft = this._threshold;

        for (var i = 0; i < this._peers.length; i++) {
            const peer = this._peers[i];
            if (deepContains(nodes, peer)
                    || nodes.find(node => peer.id === node)) {
                thresholdLeft -= 1;
                if (thresholdLeft <= 0) {
                    return true;
                }
            }
        }

        return false;

    }

    isVBlocking(nodes) {

        if (this._threshold == 0) {
            return false;
        }

        var leftTillBlock = (1 + this._peers.length) - this._threshold;

        for (var i = 0; i < this._peers.length; i++) {
            const peer = this._peers[i];
            if (deepContains(nodes, peer)
                    || nodes.find(node => peer.id === node)) {
                leftTillBlock -= 1;
                if (leftTillBlock <= 0) {
                    return true;
                }
            }
        }

        return false;

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
