use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::hash::hashv;

pub(crate) fn account_metadata_digest(
    key: &Pubkey,
    owner: &Pubkey,
    lamports: u64,
    executable: bool,
    rent_epoch: u64,
    data: &[u8],
) -> [u8; 32] {
    hashv(&[
        key.as_ref(),
        owner.as_ref(),
        &lamports.to_le_bytes(),
        &[u8::from(executable)],
        &rent_epoch.to_le_bytes(),
        data,
    ])
    .to_bytes()
}
