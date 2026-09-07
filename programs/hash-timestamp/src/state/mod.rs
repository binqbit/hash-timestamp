mod hash_account;
mod hash_source;
mod vote_info;

pub use hash_account::HashAccount;
pub use hash_source::HashSource;
pub use vote_info::VoteInfo;

/// Fixed `HashAccount` fields; source allocation is added by `HashSource::space`.
pub const HASH_ACCOUNT_BASE_SIZE: usize = 8 /*disc*/
    + 32 /*hash*/
    + 8  /*voters*/
    + 8  /*created_at*/
    + 1; /*bump*/
/* + X padding for HashSource variants */

/// Allocated `VoteInfo` size, including seven bytes of compatibility padding.
pub const VOTE_INFO_SPACE: usize = 8 /*disc*/
    + 32 /*voter*/
    + 32 /*hash_id*/
    + 8  /*amount*/
    + 1  /*bump*/
    + 7; /*padding*/
