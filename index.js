// LIMITIATIONS
// Quorums:
// * There is no ability to designate subquorums, just peers
// * Threshold for a quorum isn't customizable, locked at 50% agreement

const assert = require('assert');
const crypto = require('crypto');

function deepEquals(a,b) {
    return JSON.stringify(a) == JSON.stringify(b);
}

function deepContains(arr, search) {
    const jsonSearch = JSON.stringify(search);
    return !!arr.find(val => jsonSearch === JSON.stringify(val));
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function isQuorumSetSane(quorumSet, extraChecks) {

}

const VALUE_STATE = {
    VALID: 'valid',
    INVALID: 'invalid',
    MAYBE_VALID: 'maybe_valid'
}

class NominationProtocol {

    constructor(slot) {
        this.slot = slot;

        this.nominationStarted = false;
        this.roundNumber = 0;
        this.votes = []
        this.accepted = [],
        this.candidates = [],
        this.nominations = {}

    }

    stopNomination() {
        this.nominationStarted = false;
    }

    updateRoundLeaderIds() {
        const prioritizedPeers = this.slot.node.prioritizedPeers(this.slot.index, this.roundNumber);
        this.roundLeaderIds = prioritizedPeers.filter(peer => peer.priority === prioritizedPeers[0].priority)
            .map(prioritizedPeer => prioritizedPeer.peer.id);
    }

    isSubset(a, b) {
        return a.length <= b.length &&
            a.some(val => b.indexOf(val) !== -1);
    }

    isNewerStatement(data, old) {
        if (!old) {
            old = this.nominations[data.from];
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
        this.nominations[data.from] = data;
    }

    acceptedNodesFn(vote) {
        return Object.values(this.nominations)
            .filter(nomination => deepContains(nomination.accepted, vote))
            .map(nomination => nomination.from);
    }

    votesNodesFn(vote) {
        return Object.values(this.nominations)
            .filter(nomination => deepContains(nomination.votes, vote))
            .map(nomination => nomination.from);
    }

    processNomination(data) {
    
        console.log(`Process nomination on ${this.slot.node.id} for slot ${this.slot.index} from ${data.from}`);

        var res = false;

        if (this.isNewerStatement(data)) {

            if (this.isSane(data)) {

                this.recordData(data);
                res = true;

                if (this.nominationStarted) {

                    var modified = false;
                    var newCandidates = false;

                    data.votes.forEach(vote => {

                        if (deepContains(this.accepted, vote)) {
                            return;
                        }

                        if (this.slot.federatedAccept(this.acceptedNodesFn.bind(this), 
                                this.votesNodesFn.bind(this),
                                vote)) {

                            // In the real world, we would validate the value here
                            this.votes.push(vote);
                            this.accepted.push(vote);
                            modified = true;

                        }

                    });

                    data.accepted.forEach(accepted => {

                        if (deepContains(this.candidates, accepted)) {
                            return;
                        }

                        if (this.slot.federatedRatify(this.acceptedNodesFn.bind(this), accepted)) {
                            this.candidates.push(accepted);
                            newCandidates = true;
                        }

                    });

                    if (this.candidates.length === 0
                            && this.roundLeaderIds.indexOf(data.from) !== -1) {
                        const newVote = this.getNewValueFromNomination(data);
                        if (newVote) {
                            this.votes.push(newVote);
                            modified = true;
                        }
                    }

                    console.log('CURRENT NOMINATION', {
                        votes: this.votes,
                        accepted: this.accepted,
                        candidates: this.candidates,
                        nominations: this.nominations
                    });

                    if (modified) {
                        console.log(`Emitting nomination for node ${this.slot.node.id} for slot ${this.slot.index}`);
                        this.emitNomination();
                    }

                    if (newCandidates) {
                        console.log(`New candidates for node ${this.slot.node.id} for slot ${this.slot.index}`);
                        const latestCompositeCandidate = this.slot.node.combineCandidates(this.slot.index, this.candidates);
                        this.slot.bumpState(latestCompositeCandidate, false);
                    }

                    if (!modified && !newCandidates) {
                        console.log(`No updates for node ${this.slot.node.id} for slot ${this.slot.index}`);
                    }

                }
            }
        }

        if (!res) {
            console.log('CURRENT NOMINATION', {
                votes: this.votes,
                accepted: this.accepted,
                candidates: this.candidates,
                nominations: this.nominations
            });
        }

        return res;

    }

    nominate(value, timedOut) {
        // Actual SCP cares about the previous value, but we're skipping that for
        // the sake of simplicity. It might be wrong to do so, so feel free to open
        // an issue if you have a concern about this
        var updated = false;

        if (timedOut && !this.nominationStarted) {
            return false;
        }

        this.nominationStarted = true;

        this.roundNumber += 1;
        this.updateRoundLeaderIds();

        var nominatingValue;

        if (this.roundLeaderIds.indexOf(this.slot.node.id) !== -1) {
            nominatingValue = value;
            if (!deepContains(this.votes, value)) {
                updated = true;
                this.votes.push(value);
            }
        } else {
            this.roundLeaderIds.forEach(id => {
                const nomination = this.nominations[id];
                if (nomination) {
                    nominatingValue = this.getNewValueFromNomination(nomination);
                    if (nominatingValue) {
                        updated = true;
                        this.votes.push(value);
                    }
                }
            });
        }

        setTimeout(() => {
            this.nominate(value, true);
        }, this.computeTimeout());

        if (updated) {
            this.emitNomination();
        } else {
            console.log(`Nomintation skipped for node ${this.slot.node.id} on slot ${this.slot.index}`);
        }

    }

    emitNomination() {
        // In stellar-core, this emits an envelope up to the slot which then comes straight back
        // into the nomination protocol. I've removed that step to make it easier to follow.
        const data = {
            slot: this.slot.index,
            from: this.slot.node.id,
            votes: this.votes,
            accepted: this.accepted,
            quorumSetHash: this.slot.node.quorumSetHash()
        };
        if (this.processNomination(data)) {
            if (!this.lastData || this.isNewerStatement(data, this.lastData)) {
                this.lastData = clone(data);
                this.slot.node.broadcast('nominate', data);
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
                if (!deepContains(this.votes, vote)) {
                    const hash = crypto.createHash('sha256').update(JSON.stringify(vote)).digest('hex')
                    if (hash > newHash) {
                        newVote = vote;
                    }
                }
            });
        return newVote;
    }


}

class Ballot {
    constructor(counter, value) {
        this.counter = counter;
        this.value = value;
    }
}

const BALLOT_PHASE = {
    PREPARE: "prepare",
    CONFIRM: "confirm",
    EXTERNALIZE: "externalize"
}
BALLOT_PHASE.ORDERING = [
    BALLOT_PHASE.PREPARE,
    BALLOT_PHASE.CONFIRM,
    BALLOT_PHASE.EXTERNALIZE
];

class BallotProtocol {
    constructor(slot) {
        this.slot = slot;

        this.phase = BALLOT_PHASE.PREPARE
        this.currentBallot = null
        this.prepared = null
        this.preparedPrime = null
        this.highBallot = null
        this.commit = null
        this.otherBallots = {}
    }

    recordData(data) {
        this.otherBallots[data.from] = data;
    }

    isNewerStatement(data, old) {
        if (!old) {
            old = this.otherBallots[data.from];
        }
        if (old) {

            var res = false;

            if (data.phase != old.phase) {
                res = BALLOT_PHASE.ORDERING.indexOf(old.phase) < BALLOT_PHASE.ORDERING.indexOf(data.phase)
            } else {
                if (data.phase == BALLOT_PHASE.EXTERNALIZE) {
                    res = false;
                } else if (data.phase == BALLOT_PHASE.CONFIRM) {
                    const compBallot = this.compareBallots(old.ballot, data.ballot);
                    if (compBallot < 0) {
                        res = true;
                    } else if (compBallot == 0) {
                        if (old.nPrepared == data.nPrepared) {
                            res = (old.nH < data.nH)
                        } else {
                            res = (old.nPrepared < data.nPrepared)
                        }
                    }
                } else {
                    const compBallot = this.compareBallots(old.ballot, data.ballot);
                    if (compBallot < 0) {
                        res = true;
                    } else if (compBallot == 0) {
                        const compPrepBallot = this.compareBallots(old.preparedPrime, data.preparedPrime);
                        if (compPrepBallot < 0) {
                            res = true;
                        } else (compPrepBallot == 0) {
                            res = (old.nH < data.nH);   
                        }
                    }
                }
            }

            return res;

        } else {
            return true;
        }
    }

    isSane(data) {

        if (!isQuorumSetSane(data.quorumSetHash, false)) {
            return false;
        }

    }

    processBallot(data, self) {
        var res = false;
        assert(data.slot == this.slot.index);

        if (!this.isSane(data, self)) {
            return false;
        }

        if (!this.isNewerStatement(data)) {
            return false;
        }

        const validationRes = this.validateValues(data);
        if (validationRes !== VALUE_STATE.INVALID) {
      
            var processed = false;

            if (this.phase != BALLOT_PHASE.EXTERNALIZE) {
                if (validationRes !== VALUE_STATE.VALID) {
                    this.slot.setFullyValidated(false);
                }

                this.recordData(data);
                processed = true;
                this.advanceSlot(data);
                res = true;

            }

            if (!processed) {

                if (this.phase == BALLOT_PHASE.EXTERNALIZE &&
                        this.commit.value == this.getWorkingBallot(data).value)

                    this.recordData(data);
                    res = true;

                } else {

                    res = false;

                }

            }

        } else {

            res = false;
            
        }

        return res;
    }

    validateValues() {
        const values = [];
        switch(data.phase) {
            case BALLOT_PHASE.PREPARE:
                const ballot = data.ballot;
                if (ballot.counter != 0) {
                    values.push(ballot.value);
                }
                if (data.prepared) {
                    values.insert(data.prepared.value);
                }
                break;
            case BALLOT_PHASE.CONFIRM:
                values.insert(data.ballot.value);
                break;
            case BALLOT_PHASE.EXTERNALIZE:
                values.insert(data.commit.value);
                break;
            default:
                return VALUE_STATE.INVALID
        }
        var res = VALID_STATE.VALID;
        values.forEach(value => {
            const validateRes = this.slot.node.validateValue(this.slot.index, value, false);
            if (validateRes !== VALUE_STATE.VALID) {
                res = validateRes;
            }
        });
        return res;
    }

    bumpState(value, force) {
        if (!force && this.currentBallot) {
            return false;
        }

        const n = (this.currentBallot) ? (this.currentBallot.counter + 1) : 1;

        return this.bumpStateWithCounter(value, n);
    }

    bumpStateWithCounter(value, counter) {
        if (this.phase !== BALLOT_PHASE.PREPARE && this.phase != BALLOT_PHASE.CONFIRM) {
            return false;
        }

        if (this.highBallot) {
            var newBallot = new Ballot(counter, this.highBallot.value);
        } else {
            var newBallot = new Ballot(counter, value);
        }

        const updated = this.updateCurrentValue(newBallot);

        if (updated) {
            this.emitCurrentStateStatement();
            this.checkHeardFromQuorum();
        }

        return updated;
    }

    updateCurrentValue(ballot) {
        if (this.phase !== BALLOT_PHASE.PREPARE && this.phase != BALLOT_PHASE.CONFIRM) {
            return false;
        }

        var updated = false;

        if (!this.currentBallot) {
            this.bumpToBallot(ballot, true);
            updated = true;
        } else {

            // dbgAssert < 0 thing, not sure here...
            // https://github.com/stellar/stellar-core/blob/master/src/scp/BallotProtocol.cpp#L419

            if (this.commit && !this.areBallotsCompatible(this.commit, ballot)) {
                return false;
            }

            const comp = this.compareBallots(this.currentBallot, ballot);
            if (comp < 0) {
                this.bumpToBallot(ballot, true);
                updated = true;
            } else {
                // See comment at 
                // https://github.com/stellar/stellar-core/blob/master/src/scp/BallotProtocol.cpp#L434
                return false;
            }

        }

        this.checkInvariants();

        return updated;
    }

    bumpToBallot(ballot, check) {
        assert(this.phase != BALLOT_PHASE.EXTERNALIZE);

        if (check) {
            assert(!this.currentBallot || this.compareBallots(ballot, this.currentBallot) >= 0);
        }

        const gotBumped = !this.currentBallot || (this.currentBallot.counter != ballot.counter);

        this.currentBallot = new Ballot(ballot.counter, ballot.value);

        if (gotBumped) {
            this.heardFromQuorum = false;
        }
    }

    compareBallots(b1, b2) {
        if (b1 && b2) {
            
            if (b1.counter < b2.counter) {
                return -1;
            } else if (b2.counter < b1.counter) {
                return 1;
            }

            // Technically this is wrong since we can't define custom ordering for our value,
            // so this should probably use a comparitor, but meh, I'm lazy
            if (b1.value < b2.value) {
                return -1;
            } else if (b2.value < b1.value) {
                return 1;
            } else {
                return 0;
            }

        } else if (b1 && !b2) {
            return 1;
        } else if (!b1 && b2) {
            return -1;
        } else {
            return 0;
        }
    }

    areBallotsCompatible(b1, b2) {
        return deepEquals(b1.value, b2.value);
    }

    areBallotsLessAndIncompatible(b1, b2) {
        return (this.compareBallots(b1, b2) <= 0) && !this.areBallotsCompatible(b1, b2);
    }

    areBallotsLessAndCompatible(b1, b2) {
        return (this.compareBallots(b1, b2) <= 0) && this.areBallotsCompatible(b1, b2);
    }

    checkInvariants() {
        if (this.currentBallot) {
            assert(this.currentBallot.counter !== 0);
        }
        if (this.prepared && this.preparedPrime) {
            assert(this.areBallotsLessAndIncompatible(this.preparedPrime, this.prepared));   
        } 
        if (this.commit) {
            assert(this.commit);
            assert(this.areBallotsLessAndCompatible(this.commit, this.highBallot));
            assert(this.areBallotsLessAndCompatible(this.highBallot, this.currentBallot));
        }

        switch(this.phase) {
            case BALLOT_PHASE.PREPARE:
                break;
            case BALLOT_PHASE.CONFIRM:
                assert(this.commit);
                break;
            case BALLOT_PHASE.EXTERNALIZE:
                assert(this.commit);
                assert(this.highBallot);
                break;
            default:
                assert.fail();
        }
    }

    getWorkingBallot(data) {
        switch(data.phase) {
            case BALLOT_PHASE.PREPARE:
                return data.ballot;
            case BALLOT_PHASE.CONFIRM:
                return new Ballot(data.nCommit, data.ballot.value);
            case BALLOT_PHASE.EXTERNALIZE:
                return data.commit;
            default:
                assert.fail();
        }
    }
}

class Slot {
    constructor(index, node) {
        this.index = index;
        this.node = node;

        this.nominationProtocol = new NominationProtocol(this);
        this.ballotProtocol = new BallotProtocol(this);

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

    nominate(value) {
        this.nominationProtocol.nominate(value);
    }

    processNomination(data) {
        this.nominationProtocol.processNomination(data);
    }

    bumpState(value, force) {
        this.ballotProtocol.bumpState(value, force);
    }
}

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
