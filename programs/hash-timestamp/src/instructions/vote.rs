use anchor_lang::prelude::*;

use anchor_lang::solana_program::program_error::ProgramError;

use crate::logic::{create_vote_account_for_hash, derive_hash, derive_vote, ensure_hash_initialized};
use crate::state::HashAccount;

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub hash_account: Account<'info, HashAccount>,

    /// CHECK: Created within the instruction via `create_vote_account_for_hash`.
    #[account(mut)]
    pub vote_info: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn vote(ctx: Context<Vote>) -> Result<()> {
    let hash_account = &mut ctx.accounts.hash_account;
    let vote_account = &ctx.accounts.vote_info;
    let user = &ctx.accounts.user;
    let user_info = user.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();

    let hash_snapshot = ensure_hash_initialized(hash_account, ctx.program_id)?;

    let rent = Rent::get()?;
    let hash_rent = rent.minimum_balance(hash_snapshot.space());

    hash_account.voters = hash_account
        .voters
        .checked_add(1)
        .ok_or(ProgramError::InvalidInstructionData)?;

    let hash_account_info = hash_account.to_account_info();
    let derived_hash = derive_hash(ctx.program_id, hash_snapshot.source(), hash_snapshot.hash());
    let derived_vote = derive_vote(ctx.program_id, derived_hash.canonical_id(), &user.key());

    create_vote_account_for_hash(
        ctx.program_id,
        &user_info,
        &system_program,
        &hash_account_info,
        vote_account,
        &derived_hash,
        &derived_vote,
        hash_rent,
        hash_rent,
    )?;

    Ok(())
}
