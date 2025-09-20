use anchor_lang::prelude::*;

// Space helpers
pub const HASH_ACCOUNT_SPACE: usize = 8 /*disc*/
    + 32 /*hash*/
    + 8  /*voters*/
    + 8  /*created_at*/
    + 1  /*bump*/
    + 7; /*padding*/

pub const VOTE_INFO_SPACE: usize = 8 /*disc*/
    + 32 /*voter*/
    + 32 /*hash*/
    + 8  /*amount*/
    + 1  /*bump*/
    + 7; /*padding*/

#[account]
pub struct HashAccount {
    pub hash: [u8; 32],
    pub voters: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct VoteInfo {
    pub voter: Pubkey,
    pub hash: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}
