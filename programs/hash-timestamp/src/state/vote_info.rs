use anchor_lang::prelude::*;

#[account]
pub struct VoteInfo {
    pub voter: Pubkey,
    pub hash_id: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}

impl VoteInfo {
    pub fn derive_pda(program_id: &Pubkey, hash_id: &[u8; 32], voter: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"vote", voter.as_ref(), hash_id.as_ref()], program_id)
    }
}
