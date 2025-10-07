use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::ErrorCode;

// Space helpers
pub const PREVIOUS_BLOCK_SIZE: usize = 32 /*hash_id*/
    + 8  /*created_at*/
    + 8; /*generation*/

pub const HASH_ACCOUNT_SPACE: usize = 8 /*disc*/
    + PREVIOUS_BLOCK_SIZE
    + 32 /*hash*/
    + 8  /*voters*/
    + 8  /*created_at*/
    + 1  /*bump*/
    + 7; /*padding*/

pub const VOTE_INFO_SPACE: usize = 8 /*disc*/
    + 32 /*voter*/
    + 32 /*hash_id*/
    + 8  /*amount*/
    + 1  /*bump*/
    + 7; /*padding*/

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug)]
pub struct PreviousBlock {
    pub hash_id: [u8; 32],
    pub created_at: i64,
    pub generation: u64,
}

#[account]
pub struct HashAccount {
    pub previous: PreviousBlock,
    pub hash: [u8; 32],
    pub voters: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct VoteInfo {
    pub voter: Pubkey,
    pub hash_id: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}
