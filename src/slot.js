const NominationProtocol = require('./nomination');
const BallotProtocol = require('./ballot');

class Slot {
    constructor(index, node) {
        this.index = index;
        this.node = node;
        this.fullyValidated = true; // false if not a validator but this is a toy soooooo.....

        this.nominationProtocol = new NominationProtocol(this);
        this.ballotProtocol = new BallotProtocol(this);

    }

    federatedAccept(votesNodesFn, acceptedNodesFn, vote) {

        const acceptedNodeIds = acceptedNodesFn(vote);

        if (this.node.isVBlocking(acceptedNodeIds)) {
            return true;
        }

        const combinedNodeIds = votesNodesFn(vote);
        acceptedNodeIds.filter(id => combinedNodeIds.indexOf(id) === -1)
            .forEach(id => combinedNodeIds.push(id));

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
        return this.nominationProtocol.processNomination(data);
    }

    stopNomination() {
        return this.nominationProtocol.stopNomination();
    }

    processBallot(data) {
        return this.ballotProtocol.processBallot(data);
    }

    bumpState(value, force) {
        this.ballotProtocol.bumpState(value, force);
    }

    getLatestCompositeCandidate() {
        return this.nominationProtocol.latestCompositeCandidate;
    }

    setFullyValidated(v) {
        this.fullyValidated = false;
    }

    isFullyValidated() {
        return this.fullyValidated;
    }
}

module.exports = Slot;
