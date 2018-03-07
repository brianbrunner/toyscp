const NominationProtocol = require('./nomination');
const BallotProtocol = require('./ballot');

class Slot {
    constructor(index, node) {
        this.index = index;
        this.node = node;

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
        this.nominationProtocol.processNomination(data);
    }

    bumpState(value, force) {
        this.ballotProtocol.bumpState(value, force);
    }
}

module.exports = Slot;
