const assert = require('assert');

const utils = require('./utils');

const VALUE_STATE = {
    VALID: 'valid',
    INVALID: 'invalid',
    MAYBE_VALID: 'maybe_valid'
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
                        } else if (compPrepBallot == 0) {
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
                        this.commit.value == this.getWorkingBallot(data).value) {

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
