use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;

use crate::state::HashAccount;
use crate::utils::{close_account, move_lamports};

pub fn release_vote_from_hash<'info>(
    hash_account: &mut Account<'info, HashAccount>,
    vote_account: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    vote_amount: u64,
) -> Result<bool> {
    let hash_info = hash_account.to_account_info();
    let is_last_voter = hash_account.voters == 1;

    close_account(vote_account, recipient)?;

    hash_account.voters = hash_account
        .voters
        .checked_sub(1)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if is_last_voter {
        close_account(&hash_info, recipient)?;
    } else if vote_amount > 0 {
        move_lamports(&hash_info, recipient, vote_amount)?;
    }

    Ok(is_last_voter)
}
