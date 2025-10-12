use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::state::VoteInfo;
use crate::utils::read_account;
use crate::ErrorCode;

pub fn ensure_vote_matches(
    account: &AccountInfo,
    expected_hash_id: &[u8; 32],
    expected_voter: &Pubkey,
) -> Result<VoteInfo> {
    let vote: VoteInfo = read_account(account)?;
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
