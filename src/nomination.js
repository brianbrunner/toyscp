const crypto = require('crypto');

const utils = require('./utils');

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
            .filter(nomination => utils.deepContains(nomination.accepted, vote))
            .map(nomination => nomination.from);
    }

    votesNodesFn(vote) {
        return Object.values(this.nominations)
            .filter(nomination => utils.deepContains(nomination.votes, vote))
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

                        if (utils.deepContains(this.accepted, vote)) {
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

                        if (utils.deepContains(this.candidates, accepted)) {
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
            if (!utils.deepContains(this.votes, value)) {
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
                this.lastData = utils.clone(data);
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
                if (!utils.deepContains(this.votes, vote)) {
                    const hash = crypto.createHash('sha256').update(JSON.stringify(vote)).digest('hex')
                    if (hash > newHash) {
                        newVote = vote;
                    }
                }
            });
        return newVote;
    }

}

module.exports = NominationProtocol;
