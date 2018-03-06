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

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

class Slot {
    constructor(index, node) {
        this.index = index;
        this.node = node;

        this.nominationStarted = false;
        this.roundNumber = 0;
        this.nomination = {
            votes: [],
            accepted: [],
            candidates: [],
            nominations: {}
        }

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

    updateRoundLeaderIds() {
        const prioritizedPeers = this.node.prioritizedPeers(this.index, this.roundNumber);
        this.roundLeaderIds = prioritizedPeers.filter(peer => peer.priority === prioritizedPeers[0].priority)
            .map(prioritizedPeer => prioritizedPeer.peer.id);
    }

    federatedAccept(votesNodesFn, acceptedNodesFn, vote) {

        const acceptedNodeIds = acceptedNodesFn(vote);

        console.log('ACCEPTED IDS', acceptedNodeIds);
        if (this.node.isVBlocking(acceptedNodeIds)) {
            return true;
        }

        const combinedNodeIds = votesNodesFn(vote);
        acceptedNodeIds.filter(id => combinedNodeIds.indexOf(id) === -1)
            .forEach(id => combinedNodeIds.push(id));

        console.log('COMBINED IDS', combinedNodeIds);
        if (this.node.isQuorumSlice(combinedNodeIds)) {
            return true;
        }

        return false;

    }

    federatedRatify(acceptedNodesFn, vote) {
        const acceptedNodeIds = acceptedNodesFn(vote);
        return this.node.isQuorumSlice(acceptedNodeIds);
    }

    /**
     * Nomination Protocol 
     */

    isSubset(a, b) {
        return a.length <= b.length &&
            a.some(val => b.indexOf(val) !== -1);
    }

    isNewerStatement(data, old) {
        if (!old) {
            old = this.nomination.nominations[data.from];
        }
        if (old) {
            if (this.isSubset(old.votes, data.votes)
                    && this.isSubset(old.accepted, data.accepted)
                    && (old.votes.length == data.votes.length
                        || old.accepted.length < votes.accepted.length)) {
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
        this.nomination.nominations[data.from] = data;
    }

    nominationAcceptedNodesFn(vote) {
        return Object.values(this.nomination.nominations)
            .filter(nomination => deepContains(nomination.accepted, vote))
            .map(nomination => nomination.from);
    }

    nominationVotesNodesFn(vote) {
        return Object.values(this.nomination.nominations)
            .filter(nomination => deepContains(nomination.votes, vote))
            .map(nomination => nomination.from);
    }

    processNomination(data) {
    
        console.log(`Process nomination on ${this.node.id} for slot ${this.index} from ${data.from}`);

        var res = false;

        if (this.isNewerStatement(data)) {

            if (this.isSane(data)) {

                this.recordData(data);
                res = true;

                if (this.nominationStarted) {

                    var modified = false;
                    var newCandidates = false;

                    data.votes.forEach(vote => {

                        if (deepContains(this.nomination.accepted, vote)) {
                            return;
                        }

                        if (this.federatedAccept(this.nominationAcceptedNodesFn.bind(this), 
                                this.nominationVotesNodesFn.bind(this),
                                vote)) {

                            // In the real world, we would validate the value here
                            this.nomination.votes.push(vote);
                            this.nomination.accepted.push(vote);
                            modified = true;

                        }

                    });

                    data.accepted.forEach(accepted => {

                        if (deepContains(this.nomination.candidates, accepted)) {
                            return;
                        }

                        if (this.federatedRatify(this.nominationAcceptedNodesFn.bind(this), accepted)) {
                            this.nomination.candidates.push(accepted);
                            newCandidates = true;
                        }

                    });

                    if (this.nomination.candidates.length === 0
                            && this.roundLeaderIds.indexOf(data.from) !== -1) {
                        const newVote = this.getNewValueFromNomination(data);
                        if (newVote) {
                            this.nomination.votes.push(newVote);
                            modified = true;
                        }
                    }

                    console.log('CURRENT NOMINATION', this.nomination);

                    if (modified) {
                        console.log(`Emitting nomination for node ${this.node.id} for slot ${this.index}`);
                        this.emitNomination();
                    }

                    if (newCandidates) {
                        console.log(`New candidates for node ${this.node.id} for slot ${this.index}`);
                        const latestCompositeCandidate = this.node.combineCandidates(this.index, this.nomination.candidates);
                        // Combine tx sets by picking the latest timestamp and then the longest tx set
                        // this.node.updatedCompositeCandidate(latestCompositeCandidate);
                        this.bumpState(latestCompositeCandidate, false);
                    }

                    if (!modified && !newCandidates) {
                        console.log(`No updates for node ${this.node.id} for slot ${this.index}`);
                    }

                }
            }
        }

        if (!res) {
            console.log('CURRENT NOMINATION', this.nomination);
        }

        return res;

    }

    nominate(value, previousValue, timedOut) {
        var updated = false;

        if (timedOut && !this.nominationStarted) {
            return false;
        }

        this.nominationStarted = true;

        this.previousValue = previousValue;

        this.roundNumber += 1;
        this.updateRoundLeaderIds();

        var nominatingValue;

        if (this.roundLeaderIds.indexOf(this.node.id) !== -1) {
            nominatingValue = value;
            if (!deepContains(this.nomination.votes, value)) {
                updated = true;
                this.nomination.votes.push(value);
            }
        } else {
            this.roundLeaderIds.forEach(id => {
                const nomination = this.nomination.nominations[id];
                if (nomination) {
                    nominatingValue = this.getNewValueFromNomination(nomination);
                    if (nominatingValue) {
                        updated = true;
                        this.nomination.votes.push(value);
                    }
                }
            });
        }

        setTimeout(() => {
            this.nominate(value, previousValue, true);
        }, this.computeTimeout());

        if (updated) {
            this.emitNomination();
        } else {
            console.log(`Nomintation skipped for node ${this.node.id} on slot ${this.index}`);
        }

    }

    emitNomination() {
        const data = {
            slot: this.index,
            from: this.node.id,
            votes: this.nomination.votes,
            accepted: this.nomination.accepted,
            quorumSetHash: this.node.quorumSetHash()
        };
        if (this.processNomination(data)) {
            if (!this.lastData || this.isNewerStatement(data, this.lastData)) {
                this.lastData = clone(data);
                this.node.broadcast('nominate', data);
            }
        }
    }

    computeTimeout() {
        return Math.min(this.roundNumber, 60*3)*1000;
    }

    getNewValueFromNomination(nomination) {
        var newVote;
        var newHash = '';

        nomination.votes
            .concat(nomination.accepted)
            .forEach(vote => {
                if (!deepContains(this.nomination.votes, vote)) {
                    const hash = crypto.createHash('sha256').update(JSON.stringify(vote)).digest('hex')
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
        this.id = id;
        this._startTime = options.startTime;
        this._roundLength = options.roundLength || 3000;
        this.pendingTxs = [];
        this._txNum = 0;
        this._slots = {};
    }

    setQuorum(peers) {
        if (!peers.find(peer => peer._id == this.id)) {
            peers.push(this);
        }
        this._peers = peers;
        this._threshold = Math.ceil(this._peers.length*0.5);
    }

    quorumSetHash() {
        var hash = crypto.createHash('sha256');
        this.prioritizedPeers(0,0).forEach(peer => hash = hash.update(String(peer.id)));
        return hash.digest('hex');
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
        if (this.pendingTxs.length > 0) {
            this.getSlot(this.currentSlotId()).nominate(this.pendingTxs);
        }
        this.pendingTxs = [];

        const delay = this.nextLedgerTime() - Date.now();
        setTimeout(() => {
            this.closeLedger();
        }, delay);
    }

    nextLedgerTime() {
        const now = Date.now();
        return now - (now % this._roundLength) + this._roundLength;
    }

    currentSlotId() {
        return Math.floor((Date.now() - this._startTime)/this._roundLength)
    }

    prioritizedPeers(slotId, roundNumber) {
        slotId = slotId || this.currentSlotId();
        return this._peers.map(peer => {
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
            this._peers.forEach(function(peer) {
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

        var thresholdLeft = this._threshold;

        for (var i = 0; i < this._peers.length; i++) {
            const peer = this._peers[i];
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

        if (this._threshold == 0) {
            return false;
        }

        var leftTillBlock = (1 + this._peers.length) - this._threshold;

        for (var i = 0; i < this._peers.length; i++) {
            const peer = this._peers[i];
            if (nodes.find(node => peer.id === node.id || peer.id === node)) {
                leftTillBlock -= 1;
                if (leftTillBlock <= 0) {
                    return true;
                }
            }
        }

        return false;

    }

    makeNoise() {
        if (Math.random() > .90) {
            this.broadcast('tx', {
                id: this.id,
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
n1.setQuorum([n2,n3]);
n2.setQuorum([n1,n3]);
n3.setQuorum([n1,n2]);

n1.start();
n2.start();
n3.start();
