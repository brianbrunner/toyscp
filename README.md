# toyscp

A toy implementation of the Stellar Consensus Protocol (SCP). It is a toy in the sense that it is all local and doesn't really concern itself with implementing anything practical with SCP. Rather, it is purely serving as a demonstration of how SCP works.

It attempts to clearly show that SCP is a sort of version of Leaderless Byzantine Consensus, similar to what is discussed in this [patent (free)](https://patents.google.com/patent/US7797457B2/en) and the paper (which is not free so I'm not bothering to link it) by Leslie Lamport.

SCP divides it work into numeric slots. It layers a two phase process that first nominates a value for a slot and then "externalizes" (i.e confirms) that value for that slot.

I may have a slightly broken understanding of the protocol since my specialty is not distributed systems, so please feel free to critique this where it makes sense.
