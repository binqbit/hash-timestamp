use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::state::VoteInfo;
use crate::utils::{vote_seed_bundle, SeedBundle};
use crate::ErrorCode;

#[derive(Clone, Debug)]
pub struct DerivedVote {
    pub key: Pubkey,
    pub bump: u8,
    hash_key: Pubkey,
    voter: Pubkey,
}

impl DerivedVote {
    pub fn seeds(&self) -> SeedBundle {
        vote_seed_bundle(&self.hash_key, &self.voter, self.bump)
    }

    pub fn hash_key(&self) -> &Pubkey {
        &self.hash_key
    }

    pub fn voter(&self) -> &Pubkey {
        &self.voter
    }
}

pub fn derive_vote(program_id: &Pubkey, hash_key: &Pubkey, voter: &Pubkey) -> DerivedVote {
    let (pda, bump) = VoteInfo::derive_pda(program_id, hash_key, voter);
    DerivedVote {
        key: pda,
        bump,
        hash_key: *hash_key,
        voter: *voter,
    }
}

pub fn ensure_vote_matches(
    account: &AccountInfo,
    expected_hash_id: &[u8; 32],
    expected_voter: &Pubkey,
) -> Result<VoteInfo> {
    let vote: VoteInfo = crate::utils::read_account(account)?;
    require_keys_eq!(vote.voter, *expected_voter, ErrorCode::NotVoter);
    require!(
        vote.hash_id == *expected_hash_id,
        ErrorCode::InvalidHashSeeds
    );
    Ok(vote)
}

pub fn assert_owned_by_program(
    account: &AccountInfo,
    program_id: &Pubkey,
    error: ErrorCode,
) -> Result<()> {
    if account.owner != program_id {
        return Err(error.into());
    }
    Ok(())
}

pub fn assert_system_program_placeholder(account: &AccountInfo) -> Result<()> {
    require_keys_eq!(
        account.key(),
        system_program::ID,
        ErrorCode::VoteAccountMissing
    );
    Ok(())
}

pub fn new_state(voter: Pubkey, hash_id: [u8; 32], amount: u64, bump: u8) -> VoteInfo {
    VoteInfo {
        voter,
        hash_id,
        amount,
        bump,
    }
}
