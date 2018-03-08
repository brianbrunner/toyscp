const assert = require('assert');

const utils = require('./utils');

const MAX_ADVANCE_SLOT_RECURSION = 50;

const VALUE_STATE = utils.VALUE_STATE;

class Ballot {
    constructor(counter, value) {
        this.counter = counter;
        this.value = value;
    }

    clone() {
        return new Ballot(this.counter, this.value);
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

        this.currentMessageLevel = 0;
        this.phase = BALLOT_PHASE.PREPARE;
        this.currentBallot = null;
        this.prepared = null;
        this.preparedPrime = null;
        this.highBallot = null;
        this.commit = null;
        this.otherBallots = {};
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
                        const compPrepBallot = this.compareBallots(old.prepared, data.prepared);
                        if (compBallot < 0) {
                            return true;
                        } else {
                            const compPrepPrimeBallot = this.compareBallots(old.preparedPrime, data.preparedPrime);
                            if (compPrepBallot < 0) {
                                res = true;
                            } else if (compPrepBallot == 0) {
                                res = (old.nH < data.nH);   
                            }
                        }
                    }
                }
            }

            return res;

        } else {
            return true;
        }
    }

    isSane(data, self) {

        var res = true;
        /*
        TODO Need to figure out how underlying quorum set hash is populated
        var res = isQuorumSetSane(data.quorumSetHash, false);
        if (!res) {
            return false;
        }
        */

        switch (data.phase) {
            case BALLOT_PHASE.PREPARE:

                var isOK = self || data.ballot.counter > 0;
                isOK = isOK && ((!data.prepared || !data.preparedPrime)
                        || this.areBallotsLessAndIncompatible(data.preparedPrime, data.prepared));
                isOK = isOK && (data.nH == 0 || (data.prepared && data.nH <= data.prepared.counter));
                isOK = isOK && (data.nC == 0 || (data.nH != 0 && data.ballot.counter >= data.nH &&
                                                 data.nH >= data.nC));

                if (!isOK) {
                    res = false;
                    console.log(data);
                    console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Malformed prepare`);
                }
                break;

            case BALLOT_PHASE.CONFIRM:

                res = data.ballot.counter > 0;
                res = res && (data.nH <= data.ballot.counter);
                res = res && (data.nCommit <= data.nH);

                if (!res) {
                    console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Malformed confirm`);
                }
                break;

            case BALLOT_PHASE.EXTERNALIZE:

                res = data.commit.counter;
                res = res && (data.nH >= data.commit.counter);

                if (!res) {
                    console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Malformed externalize`);
                }
                break;

            default:
                assert.fail()
        }

        return res;

    }

    processBallot(data, self) {

        console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Process ballot from ${data.from}`);
        console.log(data);

        var res = false;
        assert(data.slot == this.slot.index);

        if (!this.isSane(data, self)) {
            console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Not sane`)
            return false;
        }

        if (!this.isNewerStatement(data)) {
            console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Not newer`)
            return false;
        }

        const validationRes = this.validateValues(data);
        console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Ballot validation ${validationRes}`)
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
                        this.commit.value == this.getWorkingBallot(data).value) {

                    this.recordData(data);
                    res = true;

                } else {
            
                    console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Not processed`)
                    res = false;

                }

            }

        } else {

            res = false;
            
        }

        return res;
    }

    validateValues(data) {
        const values = [];
        switch(data.phase) {
            case BALLOT_PHASE.PREPARE:
                const ballot = data.ballot;
                if (ballot.counter != 0) {
                    values.push(ballot.value);
                }
                if (data.prepared) {
                    values.push(data.prepared.value);
                }
                break;
            case BALLOT_PHASE.CONFIRM:
                values.push(data.ballot.value);
                break;
            case BALLOT_PHASE.EXTERNALIZE:
                values.push(data.commit.value);
                break;
            default:
                return VALUE_STATE.INVALID
        }
        var res = VALUE_STATE.VALID;
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

    advanceSlot(hint) {

        this.currentMessageLevel += 1;

        if (this.currentMessageLevel >= MAX_ADVANCE_SLOT_RECURSION) {
            throw new Error("Maximum number of transitions reached in advanceSlot");
        }

        var didWork = false;

        didWork = this.attemptPreparedAccept(hint) || didWork;

        didWork = this.attemptPreparedConfirmed(hint) || didWork;

        didWork = this.attemptAcceptCommit(hint) || didWork;

        didWork = this.attemptConfirmCommit(hint) || didWork;

        if (this.currentMessageLevel == 1) {

            var didBump = false
            do {
                didBump = this.attemptBump();
                didWork = didBump || didWork;
            } while (didBump);

            if (didWork) {
                this.checkHeardFromQuorum();
            }
        }

        this.currentMessageLevel -= 1;

        if (didWork) {
            this.sendLatestStatement();
        }
    }

    getPrepareCandidates(hint) {

        const hintBallots = [];

        switch (hint.phase) {
            case BALLOT_PHASE.PREPARE:
                hintBallots.push(hint.ballot);
                if (hint.prepared) {
                    hintBallots.push(hint.prepared);
                }
                if (hint.preparedPrime) {
                    hintBallots.push(hint.preparedPrime);
                }
                break;
            case BALLOT_PHASE.CONFIRM:
                hintBallots.push(new Ballot(hint.nPrepared, hint.ballot.value));
                hintBallots.push(new Ballot(Number.MAX_SAFE_INTEGER, hint.ballot.value));
                break;
            case BALLOT_PHASE.EXTERNALIZE:
                hintBallots.push(new Ballot(Number.MAX_SAFE_INTEGER, hint.ballot.value));
                break;
            default:
                assert.fail();
        }

        const candidates = [];

        while (hintBallots.length > 0) {
            const ballot = hintBallots.pop();
            const value = ballot.value;

            Object.values(this.otherBallots)
                .forEach(other => {
                    switch (other.phase) {
                        case BALLOT_PHASE.PREPARE:
                            if (this.areBallotsLessAndCompatible(other.ballot, ballot)) {
                                candidates.push(other.ballot);
                            }
                            if (other.prepared &&
                                    this.areBallotsLessAndCompatible(other.prepared, ballot)) {
                                candidates.push(other.prepared);
                            }
                            if (other.preparedPrimed && 
                                    this.areBallotsLessAndCompatible(other.preparedPrime, ballot)) {
                                candidates.push(other.preparedPrime);
                            }
                            break;
                        case BALLOT_PHASE.CONFIRM:
                            if (this.areBallotsCompatible(ballot, other.ballot)) {
                                candidates.push(ballot);
                                if (other.nPrepared < ballot.counter) {
                                    candidates.push(new Ballot(other.nPrepared, value));
                                }
                            }
                            break;
                        case BALLOT_PHASE.EXTERNALIZE:
                            if (this.areBallotsCompatible(ballot, other.commit)) {
                                candidates.insert(ballot);
                            }
                            break;
                        default:
                            assert.fail()
                    }
                });
        }

        return utils.deepUnique(candidates).sort(this.compareBallots);

    }

    attemptPreparedAccept(hint) {
        if (this.phase !== BALLOT_PHASE.PREPARE && this.phase != BALLOT_PHASE.CONFIRM) {
            return false;
        }

        const candidates = this.getPrepareCandidates(hint);

        for (var i = 0; i < candidates.length; i++) {

            const ballot = candidates[i];

            if (this.phase == BALLOT_PHASE.CONFIRM) {
                if (!this.areBallotsLessAndCompatible(this.prepared, ballot)) {
                    continue;
                }
                assert(this.areBallotsCompatible(this.commit, ballot));
            }

            if (this.preparedPrime && this.compareBallots(ballot, this.preparedPrime) <= 0) {
                continue;
            }

            if (this.prepared && this.areBallotsLessAndCompatible(ballot, this.prepared)) {
                continue;
            }

            var accepted = this.slot.federatedAccept(
                (ballot) => {
                    return Object.values(this.otherBallots)
                        .filter(other => {
                            switch(other.phase) {
                                case BALLOT_PHASE.PREPARE:
                                    return this.areBallotsLessAndCompatible(ballot, other.ballot);
                                case BALLOT_PHASE.CONFIRM:
                                    return this.areBallotsCompatible(ballot, other.ballot);
                                case BALLOT_PHASE.EXTERNALIZE:
                                    return this.areBallotCompatible(ballot, other.commit);
                                default:
                                    assert.fail();
                            }
                        })
                        .map(other => other.from);
                },
                this.hasPreparedBallot.bind(this),
                ballot
            );
            if (accepted) {
                return this.setPreparedAccept(ballot);
            }
        }
    }

    hasPreparedBallot(ballot) {
        return Object.values(this.otherBallots)
            .filter(other => {
                switch(other.phase) {
                    case BALLOT_PHASE.PREPARE:
                        return (other.prepared && this.areBallotsLessAndCompatible(ballot, other.prepared))
                            || (other.preparedPrime && this.areBallotsLessAndCompatible(ballot, other.preparedPrime))
                    case BALLOT_PHASE.CONFIRM:
                        const prepared = new Ballot(other.nPrepared, other.ballot.value);
                        return this.areBallotsLessAndCompatible(ballot, prepared);
                    case BALLOT_PHASE.EXTERNALIZE:
                        return this.areBallotCompatible(ballot, other.commit);
                    default:
                        assert.fail();
                }
            })
            .map(other => other.from);
    }

    setPreparedAccept(ballot) {
        var didWork = this.setPrepared(ballot);

        if (this.commit && this.highBallot) {
           if ((this.prepared &&
                this.areBallotsLessAndIncompatible(this.highBallot, this.prepared)) ||
               (this.preparedPrime &&
                this.areBallotsLessAndIncompatible(this.highBallot, this.preparedPrime)))
            {
                assert(this.phase == BALLOT_PHASE.PREPARE)
                this.commit = null;
                didWork = true;
            }
        }

        if (didWork) {
            this.emitCurrentStateStatement();
        }
        
        return didWork;
    }

    setPrepared(ballot) {
        var didWork = false;

        if (this.prepared) {
            const comp = this.compareBallots(this.prepared, ballot);
            if (comp < 0) {
                if (!this.areBallotsCompatible(this.prepared, ballot)) {
                    this.preparedPrime = this.prepared.clone();
                }
                this.prepared = ballot.clone();
                didWork = true;
            } else if (comp > 0) {
                if (!this.preparedPrime || this.compareBallots(this.preparedPrime, ballot) < 0) {
                    this.preparedPrime = ballot.clone();
                    didWork = true;
                }
            }
        } else {
            this.prepared = ballot.clone();
            didWork = true;
        }
        return didWork;
    }

    attemptPreparedConfirmed(hint) {
        if (this.phase != BALLOT_PHASE.PREPARE) {
            return false;
        }

        if (!this.prepared) {
            return false;
        }

        const candidates = this.getPrepareCandidates(hint);

        var newH;
        var newHFound = false;

        var i = 0;
        for (; i < candidates.length; i++) {
            const ballot = candidates[i];

            if (this.highBallot && this.compareBallots(this.highBallot, ballot) >= 0) {
                break;
            }

            const ratified = this.slot.federatedRatify(this.hasPreparedBallot.bind(this), ballot);
            if (ratified) {
                newH = ballot;
                newHFound = true;
                break;
            }
        }

        var res = false;

        if (newHFound) {
            var newC;
            if (!this.commit &&
                    (!this.prepared || !this.areBallotsLessAndIncompatible(newH, this.prepared)) &&
                    (!this.preparedPrime || !this.areBallotsLessAndIncompatible(newH, this.preparedPrime))) {
                
                for (; i < candidates.length; i++) {
                    const ballot = candidates[i];

                    if (this.currentBallot && this.compareBallots(ballot, this.currentBallot)) {
                        break;
                    }

                    const ratified = this.slot.federatedRatify(this.hasPreparedBallot.bind(this), ballot);
                    if (ratified) {
                        newC = ballot;
                    } else {
                        break;
                    }
                }

            }
            res = this.setPreparedConfirmed(newH, newC);
        }
        return res;
    }

    setPreparedConfirmed(newH, newC) {
        var didWork = false;

        if (!this.highBallot || this.compareBallots(newH, this.highBallot) > 0) {
            didWork = true;
            this.highBallot = newH.clone();
        }

        if (newC && newC.counter != 0) {
            assert(!this.commit);
            this.commit = newC.clone();
            didWork = true;
        }

        if (didWork) {
            this.updateCurrentIfNeeded();
            this.emitCurrentStateStatement();
        }

        return didWork;
    }

    attemptAcceptCommit(hint) {
        if (this.phase != BALLOT_PHASE.PREPARE && this.phase != BALLOT_PHASE.CONFIRM) {
            return false;
        }

        var ballot;
        switch (hint.phase) {
            case BALLOT_PHASE.PREPARE:
                if (hint.nC != 0) {
                   ballot = new Ballot(hint.nH, hint.ballot.value); 
                } else {
                    return false;
                }
                break;
            case BALLOT_PHASE.CONFIRM:
                ballot = new Ballot(hint.nH, hint.ballot.value);
                break;
            case BALLOT_PHASE.EXTERNALIZE:
                ballot = new Ballot(hint.nH, hint.commit.value);
                break;
            default:
                assert.fail();
        }

        if (this.phase == BALLOT_PHASE.CONFIRM) {
            if (!this.areBallotsCompatible(ballot, this.highBallot)) {
                return false;
            }
        }

        const pred = (interval) => {
            return this.slot.federatedAccept(
                (cur) => {
                    return Object.values(this.otherBallots)
                        .filter(other => {
                            switch(other.phase) {
                                case BALLOT_PHASE.PREPARE:
                                    if (this.areBallotsCompatible(ballot, other.ballot) && other.nC != 0) {
                                        return other.nC <= cur[0] && cur[1] <= other.nH;
                                    }
                                    break;
                                case BALLOT_PHASE.CONFIRM:
                                    if (this.areBallotsCompatible(ballot, other.ballot)) {
                                        return other.nCommit <= cur[0];
                                    }
                                    break;
                                case BALLOT_PHASE.EXTERNALIZE:
                                    if (this.areBallotsCompatible(ballot, other.commit)) {
                                        return other.commit.counter <= cur[0];
                                    }
                                default:
                                    assert.fail();
                            }
                        })
                        .map(other => other.from);
                },
                (interval) => {
                    return this.commitPredicate(ballot, interval);
                },
                interval
            );
        }

        const boundaries = this.getCommitBoundariesFromStatements(ballot);

        if (boundaries.length == 0) {
            return false;
        }

        const candidate = this.findExtendedInterval(boundaries, pred);

        var res = false;

        if (candidate[0] != 0) {
            if (this.phase != BALLOT_PHASE.CONFIRM || candidate[1] > this.highBallot.counter) {
                const c = new Ballot(candidate[0], ballot.value);
                const h = new Ballot(candidate[1], ballot.value);
                res = this.setAcceptCommit(c, h);
            }
        }

        return res;
    }

    findExtendedInterval(boundaries, pred) {
        var candidate = [0,0];
        for (var i = 0; i < boundaries.length; i++) {
            const b = boundaries[i];

            var cur = [0,0];
            if (candidate[0] == 0) {
                cur = [b,b];
            } else if (b > candidate[1]) {
                continue;
            } else {
                cur[0] = b;
                cur[1] = candidate[1];
            }

            if (pred(cur)) {
                candidate = cur;
            } else if (candidate[0] != 0) {
                break;
            }
        }
        return candidate;
    }

    commitPredicate(ballot, check) {
        return Object.values(this.otherBallots)
            .filter(other => {
                switch(other.phase) {
                    case BALLOT_PHASE.PREPARE:
                        break;
                    case BALLOT_PHASE.CONFIRM:
                        if (this.areBallotsCompatible(ballot, other.ballot)) {
                            return other.nCommit <= check[0] && check[1] <= other.nH;
                        }
                    case BALLOT_PHASE.EXTERNALIZE:
                        if (this.areBallotsCompatible(ballot, other.commit)) {
                            res = other.commit.counter <= check[0];
                        }
                    default:
                        assert.fail()
                }
            })
            .map(other => other.from);
    }

    setAcceptCommit(c, h) {
        var didWork = false;

        if (!this.highBallot || !this.commit || this.compareBallots(this.highBallot, h) != 0 ||
                this.compareBallots(this.commit, c) != 0) {
            this.commit = c.clone();
            this.highBallot = h.clone();
            didWork = true;
        }

        if (this.phase == BALLOT_PHASE.PREPARE) {
            this.phase = BALLOT_PHASE.CONFIRM;
            if (this.currentBallot && !this.areBallotsLessAndCompatible(h, this.currentBallot)) {
                this.bumpToBallot(h, false);
            }
            this.preparedPrime = null;
            didWork = true;
        }

        if (didWork) {
            this.updateCurrentIfNeeded();
            this.emitCurrentStateStatement();
        }

        return didWork;
    }

    attemptConfirmCommit(hint) {
        
        if (this.phase != BALLOT_PHASE.CONFIRM || !this.highBallot || !this.commit) {
            return false;
        }

        var ballot;
        switch (hint.phase) {
            case BALLOT_PHASE.PREPARE:
                return false;
            case BALLOT_PHASE.CONFIRM:
                ballot = new Ballot(hint.nH, hint.ballot.value);
                break;
            case BALLOT_PHASE.EXTERNALIZE:
                ballot = new Ballot(hint.nH, hint.commit.value);
                break;
            default:
                assert.fail();
        }

        if (!this.areBallotsCompatible(ballot, this.commit)) {
            return false;
        }

        const boundaries = this.getCommitBoundariesFromStatements(ballot);

        const pred = (cur) => {
            return this.slot.federatedRatify(
                (interval) => {
                    const nodes = this.commitPredicate(ballot, interval);
                    console.log(nodes);
                    return nodes;
                },
                cur
            )
        }

        const candidate = this.findExtendedInterval(boundaries, pred);

        console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Boundaries ${boundaries}`);

        console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Candidate ${candidate}`);
        console.log(this.highBallot);

        var res = (candidate[0] != 0);
        if (res) {
            const c = new Ballot(candidate[0], ballot.value);
            const h = new Ballot(candidate[1], ballot.value);
            return this.setConfirmCommit(c, h);
        }
        return res;
    }

    setConfirmCommit(c, h) {

        this.commit = c.clone();
        this.highBallot = h.clone();
        this.updateCurrentIfNeeded();

        this.phase = BALLOT_PHASE.EXTERNALIZE;

        this.emitCurrentStateStatement();

        this.slot.stopNomination();

        this.slot.node.valueExternalized(this.slot.index, this.commit.value);

        return true;
    }

    attemptBump() {
        if (this.phase == BALLOT_PHASE.PREPARE || this.phase == BALLOT_PHASE.CONFIRM) {
            var allCounters = [];
            Object.values(this.otherBallots)
                .forEach(other => {
                    switch (other.phase) {
                        case BALLOT_PHASE.PREPARE:
                        case BALLOT_PHASE.CONFIRM:
                            allCounters.push(other.ballot.counter);
                            break;
                        case BALLOT_PHASE.EXTERNALIZE:
                            allCounters.push(Number.MAX_SAFE_INTEGER);
                            break;
                        default:
                            assert.fail();
                    }
                });

            var targetCounter = this.currentBallot ? this.currentBallot.counter : 0;
            allCounters.push(targetCounter);

            allCounters = utils.deepUnique(allCounters).sort();

            for (var i = 0; i < allCounters.length; i++) {
                const n = allCounters[i];
                if (n < targetCounter) {
                   break; 
                }

                const nodes = Object.values(this.otherBallots)
                    .filter(other => {
                        if (other.phase == BALLOT_PHASE.PREPARE || other.phase == BALLOT_PHASE.CONFIRM) {
                            return n < other.ballot.counter;
                        } else {
                            return n != Number.MAX_SAFE_INTEGER;
                        }
                    })
                    .map(other => other.from);
                const vBlocking = this.slot.node.isVBlocking(nodes);

                if (n == targetCounter) {
                    if (!vBlocking) {
                        break;
                    }
                } else {
                    if (!vBlocking) {
                        return this.abandonBallot(n);
                    }
                }
            }
        }

        return false;
    }

    getCommitBoundariesFromStatements(ballot) {
        const res = [];
        Object.values(this.otherBallots)
            .forEach(other => {
                switch(other.phase) {
                    case BALLOT_PHASE.PREPARE:
                        if (this.areBallotsCompatible(ballot, other.ballot)) {
                            if (other.nC) {
                                res.push(other.nC);
                                res.push(other.nH);
                            }
                        }
                        break;
                    case BALLOT_PHASE.CONFIRM:
                        if (this.areBallotsCompatible(ballot, other.ballot)) {
                            res.push(other.nCommit);
                            res.push(other.nH);
                        }
                        break;
                    case BALLOT_PHASE.EXTERNALIZE:
                        if (this.areBallotsCompatible(ballot, other.commit)) {
                            res.push(other.commit.counter);
                            res.push(other.nH);
                            res.push(Number.MAX_SAFE_INTEGER);
                        }
                        break;
                    default:
                        assert.fail();
                }
            });
        console.log(res);
        return utils.deepUnique(res).sort();
    }

    updateCurrentIfNeeded() {
        if (!this.currentBallot || this.compareBallots(this.currentBallot, this.highBallot) < 0) {
            this.bumpToBallot(this.highBallot, true)
        }
    }

    emitCurrentStateStatement() {
        const statement = this.createStatement();

        const canEmit = !!this.currentBallot;

        const lastStatement = this.otherBallots[this.slot.node.id];

        if (!lastStatement || !utils.deepEquals(lastStatement, statement)) {
            if (this.slot.processBallot(statement)) {
                console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Ballot sending`)
                console.log(canEmit, !lastStatement, this.isNewerStatement(statement))
                if (canEmit && (!lastStatement || this.isNewerStatement(statement, this.lastStatement))) {
                    console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Ballot sending`)
                    this.lastStatement = statement;
                    this.sendLatestStatement();
                }
            } else {
                throw new Error("Moved to a bad state (ballot protocol)");
            }
        }
    }

    createStatement() {
        this.checkInvariants();
 
        switch(this.phase) {
            case BALLOT_PHASE.PREPARE:
                return {
                    phase: BALLOT_PHASE.PREPARE,
                    quorumSetHash: this.slot.node.quorumSetHash(),
                    from: this.slot.node.id,
                    slot: this.slot.index,
                    ballot: this.currentBallot,
                    nC: (this.commit && this.commit.counter) || 0,
                    prepared: this.prepared,
                    preparedPrime: this.preparedPrime,
                    nH: (this.highBallot && this.highBallot.counter) || 0
                }
            case BALLOT_PHASE.CONFIRM:
                assert(this.areBallotsLessAndCompatible(this.commit, this.highBallot));
                console.log("PREPARED", this.prepared);
                return {
                    phase: BALLOT_PHASE.CONFIRM,
                    quorumSetHash: this.slot.node.quorumSetHash(),
                    from: this.slot.node.id,
                    slot: this.slot.index,
                    ballot: this.currentBallot,
                    nPrepared: this.prepared.counter,
                    nCommit: this.commit.counter,
                    nH: this.highBallot.counter
                }
            case BALLOT_PHASE.EXTERNALIZE: 
                assert(this.areBallotsLessAndCompatible(this.commit, this.highBallot));
                return {
                    phase: BALLOT_PHASE.EXTERNALIZE,
                    commitQuorumSetHash: this.slot.node.quorumSetHash(),
                    from: this.slot.node.id,
                    slot: this.slot.index,
                    commit: this.commit,
                    nH: this.highBallot.counter
                }
            default:
                assert.fail(); 
        }
    }

    sendLatestStatement() {
        console.log("HERE", this.currentMessageLevel, this.lastStatement)
        if (this.currentMessageLevel == 0 && this.lastStatement && this.slot.isFullyValidated()) {
            console.log("HERE")
            if (!this.lastStatementEmit || this.lastStatement != this.lastStatementEmit) {
                console.log("HERE")
                this.lastStatementEmit = this.lastStatement;
                console.log(`[${this.slot.node.id}:${this.slot.index}:${this.phase}] Emit stmt`);
                console.log(this.lastStatementEmit);
                this.slot.node.broadcast(this.lastStatementEmit.phase, this.lastStatementEmit);
            }
        }
    }

    checkHeardFromQuorum() {
        if (this.currentBallot) {
            const nodes = Object.values(this.otherBallots)
                .filter(other => {
                    if (other.phase == BALLOT_PHASE.PREPARE) {
                        return this.currentBallot.counter <= other.ballot.counter;
                    } else {
                        return true;
                    }
                })
                .map(other => other.from);
            if (this.slot.node.isQuorumSlice(nodes)) {
                const oldHQ = this.heardFromQuorum;
                this.heardFromQuorum = true;
                if (!oldHQ) {
                    if (this.phase !== BALLOT_PHASE.EXTERNALIZE) {
                        this.startBallotProtocolTimer();
                    }
                }
                if (this.phase === BALLOT_PHASE.EXTERNALIZE) {
                    this.stopBallotProtocolTimer();
                }
            } else {
                this.heardFromQuorum = false;
                this.stopBallotProtocolTimer();
            }
        }
    }

    computeTimeout() {
        return Math.min(this.currentBallot.counter, 60*3)*1000;
    }


    startBallotProtocolTimer() {
        this.ballotProtocolTimerTimeout = setTimeout(() => this.ballotProtocolTimerExpired(),
                this.computeTimeout());
    }

    stopBallotProtocolTimer() {
        clearTimeout(this.ballotProtocolTimerTimeout);
    }

    ballotProtocolTimerExpired() {
        this.abandonBallot(0);
    }

    abandonBallot(n) {
        var v = this.slot.getLatestCompositeCandidate();
        if (!v) {
            if (this.currentBallot) {
                v = this.currentBallot.value;
            }
        }
        if (v) {
            if (n == 0) {
                return this.bumpState(v, true);
            } else {
                return this.bumpState(v, n);
            }
        }
        return false;
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

        this.currentBallot = ballot.clone();

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
        return utils.deepEquals(b1.value, b2.value);
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

module.exports = BallotProtocol;
