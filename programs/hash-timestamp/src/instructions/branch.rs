use anchor_lang::prelude::*;

use crate::protocol::hash::branch::branch_source_from_snapshot;
use crate::runtime::{
    hash_record::{self, NewHashRecord},
    record_lifecycle::RecordWriter,
    vote_migration::validate_vote_migration,
};
use crate::state::HashAccount;

#[derive(Accounts)]
pub struct Branch<'info> {
    #[account(mut)]
    pub hash_account: Account<'info, HashAccount>,

    /// CHECK: Provided vote PDA for the caller on the old hash. May be uninitialized.
    #[account(mut)]
    pub vote_info: UncheckedAccount<'info>,

    /// CHECK: Created inside using the derived PDA for the new hash.
    #[account(mut)]
    pub new_hash_account: UncheckedAccount<'info>,

    /// CHECK: Created inside using the vote PDA for the new hash + caller.
    #[account(mut)]
    pub new_vote_info: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn branch(ctx: Context<Branch>, payload: [u8; 32], take_vote: bool) -> Result<()> {
    let accounts = ctx.accounts;
    let snapshot = hash_record::snapshot(ctx.program_id, &accounts.hash_account)?;
    let voter = accounts.user.key();

    let (source, hash) = branch_source_from_snapshot(&snapshot, &payload)?;
    let migration = validate_vote_migration(
        ctx.program_id,
        &snapshot,
        &accounts.vote_info,
        &voter,
        take_vote,
    )?;
    let record = NewHashRecord::now(source, hash)?;
    let writer = RecordWriter::new(ctx.program_id, &accounts.user, &accounts.system_program);
    writer.create_with_initial_vote(&accounts.new_hash_account, &accounts.new_vote_info, record)?;

    if let Some(vote) = migration {
        vote.release(&mut accounts.hash_account, &accounts.user)?;
    }
    crate::debug_log!(
        "checkpoint=instruction.done instruction=branch parent={} child={} migrated={}",
        accounts.hash_account.key(),
        accounts.new_hash_account.key(),
        take_vote
    );
    Ok(())
}
