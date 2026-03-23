use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn now_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

pub(crate) fn system_time_to_ms(value: SystemTime) -> u64 {
    match value.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_ms_is_reasonable() {
        let t = now_ms();
        assert!(t > 1_000_000_000_000);
    }

    #[test]
    fn system_time_to_ms_epoch() {
        assert_eq!(system_time_to_ms(UNIX_EPOCH), 0);
    }
}
