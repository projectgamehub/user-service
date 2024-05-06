import { customError } from "../errors/errorUtils/index.js";
import ResetPasswordRepository from "../repository/resetPasswordRepository.js";
import {
    compareBcryptHash,
    hashUsingBcrypt,
    randomOtpGenerator
} from "../utils/index.js";
import { resetPasswordMailSender } from "../utils/nodeMailer/index.js";
import UserService from "./userService.js";

class ResetPasswordService {
    constructor() {
        this.resetPasswordRepository = new ResetPasswordRepository();
        this.userService = new UserService();
    }

    async requestOtp(email) {
        // Check if user if present in the User DB or not
        const userWithEmailExist =
            await this.userService.checkIfEmailExist(email);

        // If not => Throw error
        if (!userWithEmailExist) {
            throw new customError(400, "No user found");
        }

        // Else Check if user is already present in the reset pass DB or not
        const emailExistInOtpDb = await this.resetPasswordRepository.getOtpData(
            { email }
        );
        if (emailExistInOtpDb) {
            return "OTP already requested";
        }

        // Else Generate a 4 digit OTP
        const otp = randomOtpGenerator();

        // encrypt the otp
        const encryptedOTP = hashUsingBcrypt(otp);

        // Store otp in DB
        this.resetPasswordRepository.create({
            email,
            otp: encryptedOTP
        });

        // send the mail with original OTP
        resetPasswordMailSender(email, otp);

        return "OTP requested successfully";
    }

    async resendOtp(email) {
        // Check if user is already present in the reset pass DB or not
        const userWithEmailExist =
            await this.resetPasswordRepository.getOtpData({ email }, "");

        // If not => Throw error
        if (!userWithEmailExist) {
            throw new customError(400, "OTP not requested");
        }

        // Check if last attempt time is atleat more than 60 seconds or not And
        if (Date.now() - userWithEmailExist?.lastRequestedTime < 60000) {
            throw new customError(
                400,
                "Please wait atleast 60 seconds before requesting new OTP"
            );
        }

        // Request attempts is less than equal to 3 or not
        // If not throw error
        if (userWithEmailExist.requestAttempts > 3) {
            throw new customError(
                400,
                "Maximum amount of requests reached. Please try after 1hr"
            );
        }

        // Else generate new otp
        const otp = randomOtpGenerator();

        // encrypt the otp
        const encryptedOTP = hashUsingBcrypt(otp);

        // requestAttempts++, lastRequestedTime = currTime, update encryptedOTP
        await this.resetPasswordRepository.update(
            { email },
            {
                requestAttempts: userWithEmailExist.requestAttempts + 1,
                lastRequestedTime: Date.now(),
                otp: encryptedOTP
            }
        );

        // send the mail with decrypted OTP
        resetPasswordMailSender(email, otp);

        return "OTP resent successfully";
    }

    async submitOtp(email, password, otp) {
        // Check if user is already present in the reset pass DB or not
        const userWithEmailExist =
            await this.resetPasswordRepository.getOtpData({ email }, "");

        // If not => Throw error
        if (!userWithEmailExist) {
            throw new customError(400, "OTP not requested");
        }

        // Check if submit attempts is less than equal to 3 or not
        if (userWithEmailExist.verifyAttempts > 3) {
            throw new customError(
                400,
                "Maximum amount of tries reached. Please try after 1hr"
            );
        }

        // verifyAttempts++
        await this.resetPasswordRepository.update(
            { email },
            { verifyAttempts: userWithEmailExist.verifyAttempts + 1 }
        );

        // verify the otp
        const isCorrectOtp = compareBcryptHash(otp, userWithEmailExist.otp);
        // If wrong OTP, throw error
        if (!isCorrectOtp) {
            throw new customError(400, "Wrong OTP, please try again");
        }

        // else Update the users password
        await this.userService.updateProfile({ email }, { password });

        // delete the doc from the db
        await this.resetPasswordRepository.delete({ email });

        return "Password updated successfully";
    }
}

export default ResetPasswordService;
