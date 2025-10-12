use anchor_lang::prelude::*;

use crate::logic::seeds::SeedBundle;
use crate::state::VoteInfo;

#[derive(Clone, Debug)]
pub struct DerivedVote {
    pub key: Pubkey,
    pub bump: u8,
    hash_id: [u8; 32],
    voter: Pubkey,
}

impl DerivedVote {
    pub fn seeds(&self) -> SeedBundle {
        VoteInfo::seed_bundle_from(&self.voter, &self.hash_id, self.bump)
    }

    pub fn hash_id(&self) -> &[u8; 32] {
        &self.hash_id
    }

    pub fn voter(&self) -> &Pubkey {
        &self.voter
    }
}

pub fn derive_vote(program_id: &Pubkey, hash_id: &[u8; 32], voter: &Pubkey) -> DerivedVote {
    let (pda, bump) = VoteInfo::derive_pda(program_id, hash_id, voter);
    DerivedVote {
        key: pda,
        bump,
        hash_id: *hash_id,
        voter: *voter,
    }
}

pub fn new_state(voter: Pubkey, hash_id: [u8; 32], amount: u64, bump: u8) -> VoteInfo {
    VoteInfo {
        voter,
        hash_id,
        amount,
        bump,
    }
}
