use anchor_lang::prelude::*;

use crate::logic::branch_and_maybe_migrate_vote;
use crate::state::HashAccount;

#[derive(Accounts)]
pub struct Branch<'info> {
    #[account(mut)]
    pub old_hash_account: Account<'info, HashAccount>,

    /// CHECK: Created inside using the derived PDA for the new hash.
    #[account(mut)]
    pub new_hash_account: AccountInfo<'info>,

    /// CHECK: Provided vote PDA for the caller on the old hash. May be uninitialized.
    #[account(mut)]
    pub old_vote_info: AccountInfo<'info>,

    /// CHECK: Created inside using the vote PDA for the new hash + caller.
    #[account(mut)]
    pub new_vote_info: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn branch(ctx: Context<Branch>, payload: [u8; 32], take_vote: bool) -> Result<()> {
    let system_program = ctx.accounts.system_program.to_account_info();
    let user = &ctx.accounts.user;

    branch_and_maybe_migrate_vote(
        ctx.program_id,
        &system_program,
        &mut ctx.accounts.old_hash_account,
        &ctx.accounts.new_hash_account,
        &ctx.accounts.old_vote_info,
        &ctx.accounts.new_vote_info,
        user,
        payload,
        take_vote,
    )
}
