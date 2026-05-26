# Caro Online

Game cờ caro chơi online với bạn bè bằng Firebase Realtime Database.

## Chạy dự án

```bash
npm install
npm run dev
```

## Tính năng

- Tạo phòng hoặc nhập mã phòng để chơi cùng bạn bè
- Đồng bộ bàn cờ thời gian thực qua Firebase
- 2 người chơi với quân `X` và `O`
- Nút chơi lại và rời phòng

## Firebase

File `/src/firebase.js` đã cấu hình sẵn Firebase theo thông tin bạn cung cấp. Nếu muốn deploy thực tế, hãy bảo đảm Realtime Database của dự án cho phép client đọc/ghi dữ liệu phòng chơi phù hợp với rule của bạn.